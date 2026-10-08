import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';
import { GachaConfigService } from '@/gacha/gacha-config.service';
import { GachaService } from '@/gacha/gacha.service';
import { NotificationService } from '@/notification/notification.service';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Escrow de troca: carta em duas propostas PENDING ao mesmo tempo é
 * impossível, e uma troca encerrada devolve carta (ACTIVE) e reserva.
 */
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/animesice-db-test');

  const prisma = new PrismaService();
  await prisma.$connect();
  const ids: string[] = [];
  const cardIds: string[] = [];
  try {
    const config = new GachaConfigService(prisma);
    await config.refresh();
    const accounting = new CrystalAccountingService();
    const gacha = new GachaService(
      prisma,
      config,
      accounting,
      new NotificationService(prisma),
    );
    const users = await Promise.all(
      ['alice', 'bob', 'carol'].map((name) =>
        prisma.user.create({
          data: {
            email: `trade-escrow-${name}-${randomUUID()}@example.com`,
            password: 'unused',
            role: 'USER',
            isVerified: true,
          },
        }),
      ),
    );
    ids.push(...users.map((u) => u.id));
    const alice = users[0]!;
    const bob = users[1]!;
    const carol = users[2]!;
    const card = await prisma.card.create({
      data: {
        malCharacterId: -Math.floor(Math.random() * 2_000_000_000) - 1,
        name: `Trade escrow check ${randomUUID()}`,
        rarity: 'COMUM',
      },
    });
    cardIds.push(card.id);
    const copy = async (userId: string) =>
      prisma.userCard.create({
        data: {
          userId,
          cardId: card.id,
          status: 'ACTIVE',
          condition: 0.5,
          edition: 1,
          value: 10,
          rankedValue: 10,
        },
      });
    const [aliceCard, bobCard, carolCard] = await Promise.all([
      copy(alice.id),
      copy(bob.id),
      copy(carol.id),
    ]);
    await gacha.adjustCrystals(alice.id, 500, 'Trade escrow setup');
    await gacha.adjustCrystals(bob.id, 500, 'Trade escrow setup');

    // 1. Criar a troca coloca as duas cartas em ESCROW e reserva os Cristais.
    const trade = await gacha.createTrade(
      alice.id,
      [aliceCard.id],
      [bobCard.id],
      120,
      0,
    );
    assert.equal(trade.crystalsOffered, 120);
    assert.equal(trade.round, 1);
    const escrowedCards = await prisma.userCard.findMany({
      where: { id: { in: [aliceCard.id, bobCard.id] } },
      select: { id: true, status: true },
    });
    assert.deepEqual(escrowedCards.map((c) => c.status).sort(), [
      'ESCROW',
      'ESCROW',
    ]);
    const aliceWallet = await prisma.user.findUniqueOrThrow({
      where: { id: alice.id },
      select: { crystalBalance: true, crystalReserved: true },
    });
    assert.deepEqual(aliceWallet, {
      crystalBalance: 500,
      crystalReserved: 120,
    });
    assert.equal(
      await prisma.gachaTradeCard.count({
        where: { tradeId: trade.id, escrowed: true },
      }),
      2,
    );

    // 2. Mesma carta em outra proposta → 409 (escrow já taken).
    await assert.rejects(
      gacha.createTrade(carol.id, [carolCard.id], [bobCard.id], 0, 0),
      (error: unknown) => error instanceof ConflictException,
    );

    // 3. Recusar devolve carta (ACTIVE) e reserva (0) — nada preso.
    await gacha.declineTrade(bob.id, trade.id);
    assert.deepEqual(
      (
        await prisma.userCard.findMany({
          where: { id: { in: [aliceCard.id, bobCard.id] } },
          select: { id: true, status: true },
        })
      ).map((c) => c.status),
      ['ACTIVE', 'ACTIVE'],
    );
    assert.deepEqual(
      await prisma.user.findUniqueOrThrow({
        where: { id: alice.id },
        select: { crystalBalance: true, crystalReserved: true },
      }),
      { crystalBalance: 500, crystalReserved: 0 },
    );
    assert.equal(
      await prisma.gachaTradeCard.count({
        where: { tradeId: trade.id, escrowed: true },
      }),
      0,
    );

    // 4. Aceitar move os Cristais e a posse; ledger fecha (soma == saldo).
    const accepted = await gacha.createTrade(
      alice.id,
      [aliceCard.id],
      [bobCard.id],
      120,
      0,
    );
    await gacha.acceptTrade(bob.id, accepted.id);
    assert.equal(
      (
        await prisma.userCard.findUniqueOrThrow({
          where: { id: aliceCard.id },
          select: { userId: true, status: true },
        })
      ).userId,
      bob.id,
    );
    assert.deepEqual(
      await prisma.user.findUniqueOrThrow({
        where: { id: bob.id },
        select: { crystalBalance: true, crystalReserved: true },
      }),
      { crystalBalance: 620, crystalReserved: 0 },
    );
    for (const id of ids) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id } });
      const sum = await prisma.crystalEvent.aggregate({
        where: { userId: id },
        _sum: { delta: true },
      });
      assert.equal(user.crystalBalance, sum._sum.delta ?? 0);
    }

    // 5. Contraproposta fecha o pai como COUNTERED (devolvendo escrow) e
    //    abre a linha nova espelhando os lados e os Cristais.
    const bobCard2 = await copy(bob.id);
    await gacha.adjustCrystals(carol.id, 200, 'Trade counter setup');
    const countered = await gacha.createTrade(
      bob.id,
      [bobCard2.id],
      [carolCard.id],
      0,
      50,
    );
    const next = await gacha.counterTrade(carol.id, countered.id, {});
    assert.equal(next.round, 2);
    assert.equal(next.parentTradeId, countered.id);
    assert.equal(next.crystalsOffered, 50);
    assert.equal(next.crystalsRequested, 0);
    assert.equal(
      (
        await prisma.gachaTrade.findUniqueOrThrow({
          where: { id: countered.id },
        })
      ).closedReason,
      'COUNTERED',
    );
    // Pai devolvido (escrowed=false) e linha nova segurando as DUAS cartas —
    // as duas, porque troca viva sempre trava os dois lados (passo 1).
    assert.equal(
      await prisma.gachaTradeCard.count({
        where: { tradeId: countered.id, escrowed: true },
      }),
      0,
    );
    assert.equal(
      await prisma.gachaTradeCard.count({
        where: { tradeId: next.id, escrowed: true },
      }),
      2,
    );
    assert.deepEqual(
      (
        await prisma.userCard.findMany({
          where: { id: { in: [bobCard2.id, carolCard.id] } },
          select: { id: true, status: true },
        })
      )
        .map((c) => c.status)
        .sort(),
      ['ESCROW', 'ESCROW'],
    );
    // Reserva segue o pagador original, que virou recebedor: carol segura os
    // 50, bob não segura nada.
    // Compara por id, não por posição: o Postgres não garante ordem sem
    // orderBy e comparar arrays posição-a-posição deixa o check flaky.
    const reserved = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: [bob.id, carol.id] } },
          select: { id: true, crystalReserved: true },
        })
      ).map((u) => [u.id, u.crystalReserved]),
    );
    assert.equal(reserved.get(bob.id), 0);
    assert.equal(reserved.get(carol.id), 50);

    console.log(
      'Trade escrow: duplicata barrada, escrow e reserva devolvidos no decline, aceite com Cristais OK',
    );
  } finally {
    // GachaTradeCard usa ON DELETE RESTRICT em UserCard: derruba troca antes
    // de derrubar dono.
    await prisma.gachaTrade.deleteMany({
      where: { offeredUserId: { in: ids } },
    });
    await prisma.userCard.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
