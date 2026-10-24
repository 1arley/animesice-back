import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { Client } from 'pg';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import {
  ExecutionContext,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import { GachaController } from '@/gacha/gacha.controller';
import { GachaService } from '@/gacha/gacha.service';
import { EconomyService } from '@/gacha/economy/economy.service';
import { GachaConfigService } from '@/gacha/gacha-config.service';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';

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

async function withRerollBarrier<T>(
  operationId: string,
  run: () => Promise<T>,
) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().replaceAll('-', '');
  const sequence = `reroll_barrier_${suffix}`;
  const functionName = `reroll_barrier_${suffix}`;
  const trigger = `reroll_barrier_${suffix}`;
  await client.connect();
  try {
    await client.query(`CREATE SEQUENCE public."${sequence}"`);
    await client.query(`
      CREATE FUNCTION public."${functionName}"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        arrival BIGINT;
        started_at TIMESTAMPTZ := clock_timestamp();
      BEGIN
        IF TG_OP = 'INSERT' AND NEW."operationId" = '${operationId}' THEN
          arrival := nextval('public."${sequence}"');
          WHILE arrival = 1 AND
            (SELECT last_value FROM public."${sequence}") < 2 LOOP
            IF clock_timestamp() - started_at > interval '3 seconds' THEN
              RAISE EXCEPTION 'reroll concurrency barrier timed out';
            END IF;
            PERFORM pg_sleep(0.01);
          END LOOP;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`
      CREATE TRIGGER "${trigger}"
      BEFORE INSERT ON public."GachaItemOperation"
      FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()
    `);
    return await run();
  } finally {
    try {
      await client.query(
        `DROP TRIGGER IF EXISTS "${trigger}" ON public."GachaItemOperation"`,
      );
    } finally {
      try {
        await client.query(
          `DROP FUNCTION IF EXISTS public."${functionName}"()`,
        );
      } finally {
        try {
          await client.query(`DROP SEQUENCE IF EXISTS public."${sequence}"`);
        } finally {
          await client.end();
        }
      }
    }
  }
}

async function withRandom<T>(value: number, run: () => Promise<T>) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return await run();
  } finally {
    Math.random = original;
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
  const accounting = new CrystalAccountingService();
  const economy = new EconomyService(prisma, accounting, config);
  const service = new GachaService(
    prisma,
    config,
    accounting,
    new NotificationService(prisma),
    economy,
  );
  const ids: string[] = [];
  const cardIds: string[] = [];
  const module = await Test.createTestingModule({
    controllers: [GachaController],
    providers: [
      GachaService,
      EconomyService,
      CrystalAccountingService,
      NotificationService,
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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
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
    // daily_bonus semeado em 350 (GachaConfig), não 200.
    assert.equal((await wallet(buyer)).balance, 350);
    // dailyBonus() usa GachaDailyBonus (o HTTP usa GachaDailyClaim): semeia a
    // linha explicitamente para simular o dia anterior.
    await prisma.gachaDailyBonus.upsert({
      where: { userId: buyer },
      create: { userId: buyer, lastClaim: new Date(Date.now() - 86_400_000) },
      update: { lastClaim: new Date(Date.now() - 86_400_000) },
    });
    assert.deepEqual(await service.dailyBonus(buyer), {
      balance: 700,
      claimed: 350,
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
    assert.equal((await wallet(buyer)).balance, 600);
    assert.equal((await wallet(seller)).balance, 90);
    assert.equal((await service.status(buyer)).pointsBalance, 101);
    assert.equal((await service.status(seller)).pointsBalance, 0);
    // Reroll = round(cardFloors.COMUM 500 * 0.15) = 75.
    const rerollOperationId = randomUUID();
    const beforeReroll = (await wallet(buyer)).balance;
    const rerollRequests = await withRerollBarrier(rerollOperationId, () =>
      Promise.all(
        Array.from({ length: 2 }, () =>
          request(server)
            .post('/api/gacha/reroll')
            .set('x-test-user', buyer)
            .send({ userCardId: owned.id, operationId: rerollOperationId }),
        ),
      ),
    );
    assert.deepEqual(
      rerollRequests.map((response) => response.status),
      [201, 201],
    );
    const [rerollFirst, rerollSecond] = rerollRequests;
    assert.ok(rerollFirst);
    assert.ok(rerollSecond);
    assert.deepEqual(rerollFirst.body, rerollSecond.body);
    const rerolled = rerollFirst.body;
    assert.equal((await wallet(buyer)).balance, beforeReroll - 75);
    assert.equal((await wallet(buyer)).balance, 525);
    assert.equal((await service.status(buyer)).pointsBalance, rerolled.value);
    const currentRerollCard = await request(server)
      .get(`/api/gacha/collection/${owned.id}`)
      .set('x-test-user', buyer)
      .expect(200);
    assert.equal(currentRerollCard.body.card.condition, rerolled.condition);
    await request(server)
      .post('/api/gacha/reroll')
      .set('x-test-user', buyer)
      .send({
        userCardId: owned.id,
        operationId: rerollOperationId,
        useProtection: true,
      })
      .expect(409);

    await service.adjustCrystals(buyer, 1500, 'Cosmetic test');
    await service.buyCosmetic(buyer, 'FRAME_AURORA');
    assert.equal((await wallet(buyer)).balance, 525);
    assert.equal((await service.status(buyer)).pointsBalance, rerolled.value);
    await assert.rejects(service.buyCosmetic(buyer, 'FRAME_AURORA'));
    assert.equal((await wallet(buyer)).balance, 525);

    // Débito concorrente: saldo permite um -300, não dois. Serializado pelo
    // lock de wallet, o segundo é rejeitado em vez de deixar saldo negativo.
    const debits = await Promise.allSettled([
      service.adjustCrystals(buyer, -300, 'Concurrent debit'),
      service.adjustCrystals(buyer, -300, 'Concurrent debit'),
    ]);
    assert.equal(debits.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await wallet(buyer)).balance, 225);
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
    await prisma.userCard.update({
      where: { id: minted.id },
      data: { condition: 0.5 },
    });
    await prisma.gachaInventory.upsert({
      where: { userId: seller },
      create: { userId: seller },
      update: { protecao: 0 },
    });
    const beforeProtectedFailure = (await wallet(seller)).balance;
    const failedOperationId = randomUUID();
    await request(server)
      .post('/api/gacha/reroll')
      .set('x-test-user', seller)
      .send({
        userCardId: minted.id,
        operationId: failedOperationId,
        useProtection: true,
      })
      .expect(400);
    assert.equal((await wallet(seller)).balance, beforeProtectedFailure);
    assert.equal(
      await prisma.gachaItemOperation.count({
        where: { userId: seller, operationId: failedOperationId },
      }),
      0,
    );
    const beforeTrade = await Promise.all(ids.map(wallet));
    const trade = await service.createTrade(
      buyer,
      [owned.id],
      [minted.id],
      0,
      0,
    );
    await service.acceptTrade(seller, trade.id);
    assert.deepEqual(await Promise.all(ids.map(wallet)), beforeTrade);
    await request(server)
      .get(`/api/gacha/collection/${owned.id}`)
      .set('x-test-user', buyer)
      .expect(200)
      .expect(({ body }) => assert.equal(body.card, null));
    const transferredCard = await request(server)
      .get(`/api/gacha/collection/${owned.id}`)
      .set('x-test-user', seller)
      .expect(200);
    assert.equal(transferredCard.body.card.id, owned.id);
    const replayAfterTransfer = await request(server)
      .post('/api/gacha/reroll')
      .set('x-test-user', buyer)
      .send({
        userCardId: owned.id,
        useProtection: false,
        operationId: rerollOperationId,
      })
      .expect(201);
    assert.deepEqual(replayAfterTransfer.body, rerolled);

    const rollbackCard = await prisma.userCard.create({
      data: {
        userId: buyer,
        cardId: card.id,
        condition: 0.5,
        foil: 'NORMAL',
        edition: 2,
        value: 101,
        rankedValue: 101,
      },
    });
    await prisma.gachaInventory.upsert({
      where: { userId: buyer },
      create: { userId: buyer, protecao: 1 },
      update: { protecao: 1 },
    });
    const rollbackOperationId = randomUUID();
    const beforeInvalidRequests = (await wallet(buyer)).balance;
    await request(server)
      .post('/api/gacha/reroll')
      .set('x-test-user', buyer)
      .send({ userCardId: rollbackCard.id, operationId: 'not-a-uuid' })
      .expect(400);
    for (const useProtection of ['true', 'false', 0, 1, null]) {
      await request(server)
        .post('/api/gacha/reroll')
        .set('x-test-user', buyer)
        .send({
          userCardId: rollbackCard.id,
          operationId: randomUUID(),
          useProtection,
        })
        .expect(400);
    }
    assert.equal((await wallet(buyer)).balance, beforeInvalidRequests);
    const failureSuffix = randomUUID().replaceAll('-', '');
    const failureFunction = `fail_reroll_${failureSuffix}`;
    const failureTrigger = `fail_reroll_${failureSuffix}`;
    const failureClient = new Client({
      connectionString: process.env.DATABASE_URL,
    });
    await failureClient.connect();
    try {
      await failureClient.query(`
        CREATE FUNCTION public."${failureFunction}"()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."operationId" = '${rollbackOperationId}' THEN
            RAISE EXCEPTION 'intentional reroll rollback check';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await failureClient.query(`
        CREATE TRIGGER "${failureTrigger}"
        BEFORE UPDATE ON public."GachaItemOperation"
        FOR EACH ROW EXECUTE FUNCTION public."${failureFunction}"()
      `);
      const beforeRollbackBalance = (await wallet(buyer)).balance;
      const beforeRollbackCard = await prisma.userCard.findUniqueOrThrow({
        where: { id: rollbackCard.id },
        select: { condition: true, foil: true },
      });
      const beforeRollbackEvents = await prisma.crystalEvent.count({
        where: { userId: buyer, type: 'SPEND', refId: rollbackCard.id },
      });
      await withRandom(0.01, () =>
        request(server)
          .post('/api/gacha/reroll')
          .set('x-test-user', buyer)
          .send({
            userCardId: rollbackCard.id,
            useProtection: true,
            operationId: rollbackOperationId,
          })
          .expect(500),
      );
      assert.equal((await wallet(buyer)).balance, beforeRollbackBalance);
      assert.equal(
        (
          await prisma.gachaInventory.findUniqueOrThrow({
            where: { userId: buyer },
          })
        ).protecao,
        1,
      );
      assert.deepEqual(
        await prisma.userCard.findUniqueOrThrow({
          where: { id: rollbackCard.id },
          select: { condition: true, foil: true },
        }),
        beforeRollbackCard,
      );
      assert.equal(
        await prisma.crystalEvent.count({
          where: { userId: buyer, type: 'SPEND', refId: rollbackCard.id },
        }),
        beforeRollbackEvents,
      );
      assert.equal(
        await prisma.gachaItemOperation.count({
          where: { userId: buyer, operationId: rollbackOperationId },
        }),
        0,
      );
    } finally {
      await failureClient.query(
        `DROP TRIGGER IF EXISTS "${failureTrigger}" ON public."GachaItemOperation"`,
      );
      await failureClient.query(
        `DROP FUNCTION IF EXISTS public."${failureFunction}"()`,
      );
      await failureClient.end();
    }
    const protectionOperationId = randomUUID();
    const { config: protectionConfig } = await prisma.$transaction((tx) =>
      economy.currentVersion(tx),
    );
    const bestFoil = Object.entries(protectionConfig.foil_mult).reduce(
      (best, entry) => (entry[1] > best[1] ? entry : best),
    )[0];
    const protectedCard = await prisma.userCard.create({
      data: {
        userId: buyer,
        cardId: card.id,
        condition: 0.071,
        foil: bestFoil,
        edition: 3,
        value: 101,
        rankedValue: 101,
      },
    });
    const beforeProtectedReroll = (await wallet(buyer)).balance;
    const protectedRerolls = await withRandom(0.99, () =>
      withRerollBarrier(protectionOperationId, () =>
        Promise.all(
          Array.from({ length: 2 }, () =>
            request(server)
              .post('/api/gacha/reroll')
              .set('x-test-user', buyer)
              .send({
                userCardId: protectedCard.id,
                useProtection: true,
                operationId: protectionOperationId,
              }),
          ),
        ),
      ),
    );
    assert.deepEqual(
      protectedRerolls.map((response) => response.status),
      [201, 201],
    );
    const [protectedFirst, protectedSecond] = protectedRerolls;
    assert.ok(protectedFirst);
    assert.ok(protectedSecond);
    assert.deepEqual(protectedFirst.body, protectedSecond.body);
    assert.equal(protectedFirst.body.condition, 0.071);
    assert.equal(protectedFirst.body.foil, bestFoil);
    assert.equal((await wallet(buyer)).balance, beforeProtectedReroll - 75);
    assert.equal(
      (
        await prisma.gachaInventory.findUniqueOrThrow({
          where: { userId: buyer },
        })
      ).protecao,
      0,
    );
    const protectedReplay = await request(server)
      .post('/api/gacha/reroll')
      .set('x-test-user', buyer)
      .send({
        userCardId: protectedCard.id,
        useProtection: true,
        operationId: protectionOperationId,
      })
      .expect(201);
    assert.deepEqual(protectedReplay.body, protectedFirst.body);

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
    // GachaTradeCard usa ON DELETE RESTRICT em UserCard, e agora toda troca
    // (inclusive 1:1) tem linhas de carta: derruba troca antes dos donos.
    await prisma.gachaTrade.deleteMany({
      where: {
        OR: [{ offeredUserId: { in: ids } }, { requestedUserId: { in: ids } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
