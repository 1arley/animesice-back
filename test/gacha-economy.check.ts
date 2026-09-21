import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { EconomyService } from '@/gacha/economy/economy.service';
import { PrismaService } from '@/prisma/prisma.service';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/animesice-db-test');

  const prisma = new PrismaService();
  await prisma.$connect();
  const economy = new EconomyService(prisma);
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `economy-${suffix}@example.com`,
      password: 'unused',
      isVerified: true,
      role: 'ADMIN',
      createdAt: new Date(Date.now() - 8 * 86_400_000),
      crystalBalance: 10_000,
    },
  });
  const card = await prisma.card.create({
    data: {
      malCharacterId: -Math.floor(Math.random() * 1_000_000_000),
      name: `Economy check ${suffix}`,
      rarity: 'COMUM',
    },
  });
  try {
    assert.deepEqual(await economy.claimDaily(user.id), {
      claimed: 350,
      day: expectDayKey(),
    });
    await assert.rejects(economy.claimDaily(user.id), ForbiddenException);

    await economy.buyKey(user.id);
    await economy.buyBox(user.id, 'COMMON');
    const inventory = await economy.inventory(user.id);
    assert.equal(inventory.keys, 1);
    assert.equal(inventory.commonBoxes, 1);
    assert.equal(inventory.balance, 6_350);

    const order = await economy.createBuyOrder(user.id, {
      itemType: 'CARD',
      itemId: card.id,
      price: 1_000,
    });
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .crystalReserved,
      1_000,
    );
    await economy.cancelBuyOrder(user.id, order.id);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .crystalReserved,
      0,
    );

    const expiredOrder = await economy.createBuyOrder(user.id, {
      itemType: 'CARD',
      itemId: card.id,
      price: 700,
    });
    await prisma.gachaBuyOrder.update({
      where: { id: expiredOrder.id },
      data: { expiresAt: new Date(0) },
    });
    const copy = await prisma.userCard.create({
      data: {
        userId: user.id,
        originalUserId: user.id,
        cardId: card.id,
        condition: 0.1,
        edition: 1,
        value: 0,
        status: 'ESCROW',
      },
    });
    const listing = await prisma.gachaListing.create({
      data: {
        userId: user.id,
        userCardId: copy.id,
        price: 1000,
        expiresAt: new Date(0),
      },
    });
    await Promise.all([economy.expireMarket(), economy.expireMarket()]);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .crystalReserved,
      0,
    );
    assert.equal(
      (await prisma.userCard.findUniqueOrThrow({ where: { id: copy.id } }))
        .status,
      'ACTIVE',
    );
    assert.equal(
      (
        await prisma.gachaListing.findUniqueOrThrow({
          where: { id: listing.id },
        })
      ).status,
      'EXPIRED',
    );

    const walletBefore = (
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    ).crystalBalance;
    assert.equal(
      (await economy.blockItem(user.id, 'CARD', card.id, 'Integration check'))
        .compensated,
      1,
    );
    assert.equal(
      (await economy.blockItem(user.id, 'CARD', card.id, 'Idempotency check'))
        .compensated,
      0,
    );
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .crystalBalance,
      walletBefore + 500,
    );
    assert.equal(
      (await prisma.userCard.findUniqueOrThrow({ where: { id: copy.id } }))
        .status,
      'REMOVED',
    );
  } finally {
    await prisma.card.delete({ where: { id: card.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

function expectDayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

void main();
