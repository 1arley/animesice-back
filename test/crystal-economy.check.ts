import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { Client } from 'pg';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import { GachaController } from '@/gacha/gacha.controller';
import { GachaService } from '@/gacha/gacha.service';
import { GachaConfigService } from '@/gacha/gacha-config.service';
import { PrismaService } from '@/prisma/prisma.service';

async function checkMigration() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `crystal_check_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY)');
    await client.query(
      'CREATE TABLE "UserCard" ("userId" TEXT, "value" INTEGER)',
    );
    const migrate = (name: string) =>
      client.query(
        readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'),
      );
    await migrate('20260914120000_gacha_points');
    await migrate('20260916000000_add_crystal_system');
    await client.query(
      `INSERT INTO "User" ("id", "pointsBalance") VALUES ('collector', 9999), ('empty', 123)`,
    );
    await client.query(
      `INSERT INTO "UserCard" VALUES ('collector', 101), ('collector', 101)`,
    );
    await client.query(
      `INSERT INTO "GachaPointEvent" ("id", "userId", "delta", "type") VALUES ('old', 'collector', 9999, 'MINT')`,
    );
    await migrate('20260916010000_crystal_wallet');
    const users = await client.query(
      'SELECT "id", "crystalBalance", "pointsBalance" FROM "User" ORDER BY "id"',
    );
    assert.deepEqual(users.rows, [
      { id: 'collector', crystalBalance: 101, pointsBalance: 9999 },
      { id: 'empty', crystalBalance: 0, pointsBalance: 123 },
    ]);
    assert.equal(
      (await client.query('SELECT * FROM "GachaPointEvent"')).rowCount,
      1,
    );
    assert.equal(
      (
        await client.query(
          `SELECT * FROM "CrystalEvent" WHERE "type" = 'INITIAL'`,
        )
      ).rowCount,
      2,
    );
    await assert.rejects(
      client.query(
        `UPDATE "User" SET "crystalBalance" = -1 WHERE "id" = 'empty'`,
      ),
    );
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/animesice-db-test');
  await checkMigration();

  const prisma = new PrismaService();
  const config = new GachaConfigService(prisma);
  await config.refresh();
  const service = new GachaService(prisma, config);
  const ids: string[] = [];
  const cardIds: string[] = [];
  const module = await Test.createTestingModule({
    controllers: [GachaController],
    providers: [
      GachaService,
      { provide: PrismaService, useValue: prisma },
      { provide: GachaConfigService, useValue: config },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const id = req.header('x-test-user');
        if (!id || !ids.includes(id)) throw new UnauthorizedException();
        req.user = {
          id,
          email: 'check@example.com',
          role: Role.USER,
          isVerified: req.header('x-unverified') !== 'true',
        };
        return true;
      },
    })
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  const server = app.getHttpServer() as Server;
  try {
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({
        data: {
          email: `crystal-${randomUUID()}@example.com`,
          name: 'Crystal check',
          password: 'unused',
          isVerified: true,
        },
      });
      ids.push(user.id);
    }
    const [buyer, seller] = ids as [string, string];
    const wallet = (id: string) => service.crystals(id);
    await request(server).get('/api/gacha/crystals').expect(401);
    await request(server)
      .post('/api/gacha/crystals/daily')
      .set('x-test-user', buyer)
      .set('x-unverified', 'true')
      .expect(403);
    await request(server)
      .get('/api/gacha/crystals?page=1.5')
      .set('x-test-user', buyer)
      .expect(400);
    await request(server)
      .post(`/api/gacha/admin/users/${buyer}/crystals-adjust`)
      .set('x-test-user', buyer)
      .send({ delta: 50, reason: 'forbidden' })
      .expect(403);
    const daily = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(server)
          .post('/api/gacha/crystals/daily')
          .set('x-test-user', buyer),
      ),
    );
    assert.deepEqual(
      daily.map((r) => r.status).sort(),
      [201, 403, 403, 403, 403],
    );
    assert.equal((await wallet(buyer)).balance, 200);
    await prisma.gachaDailyBonus.update({
      where: { userId: buyer },
      data: { lastClaim: new Date(Date.now() - 86_400_000) },
    });
    assert.deepEqual(await service.dailyBonus(buyer), {
      balance: 400,
      claimed: 200,
    });
    const ledger = await request(server)
      .get('/api/gacha/crystals?limit=1')
      .set('x-test-user', buyer)
      .expect(200);
    assert.equal(ledger.body.events.length, 1);
    assert.equal(ledger.body.meta.total, 2);
    const legacy = await request(server)
      .get('/api/gacha/points?limit=1')
      .set('x-test-user', buyer)
      .expect(200);
    assert.deepEqual(legacy.body, ledger.body);

    const card = await prisma.card.create({
      data: {
        malCharacterId: -Math.floor(Math.random() * 2_000_000_000) - 1,
        name: 'Crystal check',
        rarity: 'COMUM',
      },
    });
    cardIds.push(card.id);
    const owned = await prisma.userCard.create({
      data: {
        userId: seller,
        cardId: card.id,
        condition: 0.5,
        edition: 1,
        value: 101,
        rankedValue: 101,
      },
    });
    const listing = await service.createListing(seller, owned.id, 100);
    await assert.rejects(service.reroll(seller, owned.id), /Cancele o anúncio/);
    await service.buyListing(buyer, listing.id);
    assert.equal((await wallet(buyer)).balance, 300);
    assert.equal((await wallet(seller)).balance, 90);
    assert.equal((await service.status(buyer)).pointsBalance, 101);
    assert.equal((await service.status(seller)).pointsBalance, 0);
    const rerolled = await service.reroll(buyer, owned.id);
    assert.equal((await wallet(buyer)).balance, 290);
    assert.equal((await service.status(buyer)).pointsBalance, rerolled.value);
    await service.adjustCrystals(buyer, 1500, 'Cosmetic test');
    await service.buyCosmetic(buyer, 'FRAME_AURORA');
    assert.equal((await wallet(buyer)).balance, 290);
    assert.equal((await service.status(buyer)).pointsBalance, rerolled.value);
    await assert.rejects(service.buyCosmetic(buyer, 'FRAME_AURORA'));
    assert.equal((await wallet(buyer)).balance, 290);

    const debits = await Promise.allSettled([
      service.adjustCrystals(buyer, -80, 'Concurrent debit'),
      service.adjustCrystals(buyer, -80, 'Concurrent debit'),
    ]);
    assert.equal(debits.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await wallet(buyer)).balance, 210);
    const costly = await service.createListing(buyer, owned.id, 1000);
    await assert.rejects(
      service.buyListing(seller, costly.id),
      /insuficientes/,
    );
    assert.equal(
      (
        await prisma.gachaListing.findUniqueOrThrow({
          where: { id: costly.id },
        })
      ).status,
      'ACTIVE',
    );
    assert.equal(
      (await prisma.userCard.findUniqueOrThrow({ where: { id: owned.id } }))
        .userId,
      buyer,
    );
    await service.cancelListing(buyer, costly.id);

    const beforeMint = (await wallet(seller)).balance;
    const spin = await prisma.gachaSpin.create({
      data: {
        userId: seller,
        cardId: card.id,
        hour: new Date(),
        slot: 1,
        condition: 0.05,
        foil: 'NORMAL',
        value: 999,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const minted = await service.claim(seller, spin.id);
    assert.equal(
      (await wallet(seller)).balance,
      beforeMint + Math.floor(minted.value / 2),
    );
    await assert.rejects(service.claim(seller, spin.id));
    assert.equal(
      (await wallet(seller)).balance,
      beforeMint + Math.floor(minted.value / 2),
    );
    const beforeTrade = await Promise.all(ids.map(wallet));
    const trade = await service.createTrade(buyer, owned.id, minted.id);
    await service.acceptTrade(seller, trade.id);
    assert.deepEqual(await Promise.all(ids.map(wallet)), beforeTrade);

    for (const id of ids) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id } });
      const sum = await prisma.crystalEvent.aggregate({
        where: { userId: id },
        _sum: { delta: true },
      });
      assert.equal(user.crystalBalance, sum._sum.delta);
      assert.equal(user.legacyPointsBalance, 0);
      assert.equal(
        await prisma.gachaPointEvent.count({ where: { userId: id } }),
        0,
      );
    }
    console.log(
      'Crystal: migration, HTTP, daily, concurrency, market, rollback, reroll, cosmetics, mint, trades and ledger OK',
    );
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
