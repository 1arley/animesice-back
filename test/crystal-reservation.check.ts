import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';
import { EconomyService } from '@/gacha/economy/economy.service';
import { GachaConfigService } from '@/gacha/gacha-config.service';
import { GachaService } from '@/gacha/gacha.service';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/animesice-db-test');

  const prisma = new PrismaService();
  await prisma.$connect();
  let userId: string | undefined;
  let cardId: string | undefined;
  try {
    const accounting = new CrystalAccountingService();
    const gacha = new GachaService(
      prisma,
      new GachaConfigService(prisma),
      accounting,
      new NotificationService(prisma),
    );
    const economy = new EconomyService(prisma, accounting);
    const user = await prisma.user.create({
      data: {
        email: `crystal-reservation-${randomUUID()}@example.com`,
        password: 'unused',
        role: 'ADMIN',
        isVerified: true,
        createdAt: new Date(Date.now() - 8 * 86_400_000),
      },
    });
    userId = user.id;
    const card = await prisma.card.create({
      data: {
        malCharacterId: -Math.floor(Math.random() * 2_000_000_000) - 1,
        name: `Crystal reservation check ${randomUUID()}`,
        rarity: 'COMUM',
      },
    });
    cardId = card.id;

    await gacha.adjustCrystals(user.id, 1_000, 'Reservation check setup');
    const order = await economy.createBuyOrder(user.id, {
      itemType: 'CARD',
      itemId: card.id,
      price: 900,
    });
    const walletBeforeDebit = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { crystalBalance: true, crystalReserved: true },
    });
    const eventsBeforeDebit = await prisma.crystalEvent.count({
      where: { userId: user.id },
    });

    assert.deepEqual(walletBeforeDebit, {
      crystalBalance: 1_000,
      crystalReserved: 900,
    });
    await assert.rejects(
      gacha.adjustCrystals(user.id, -101, 'Debit above available balance'),
      /Crystals insuficientes/,
    );

    assert.deepEqual(
      await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { crystalBalance: true, crystalReserved: true },
      }),
      walletBeforeDebit,
    );
    assert.equal(
      await prisma.crystalEvent.count({ where: { userId: user.id } }),
      eventsBeforeDebit,
    );

    await economy.cancelBuyOrder(user.id, order.id);
    assert.equal(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { crystalReserved: true },
        })
      ).crystalReserved,
      0,
    );
    console.log(
      'Crystal reservation contract: Gacha debit rejected without wallet or ledger changes',
    );
  } finally {
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (cardId) await prisma.card.deleteMany({ where: { id: cardId } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
