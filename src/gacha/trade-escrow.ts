import { Prisma } from '@prisma/client';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';

/**
 * Escrow de troca vive aqui, e não como método do GachaService, porque o
 * EconomyService precisa liberar troca ao bloquear uma carta — e injetar o
 * GachaService no EconomyService só criaria um segundo caminho de DI para a
 * mesma regra. funções puras sobre `tx`: quem chama já está numa transação
 * aberta e decide o nível de isolamento.
 */

/**
 * Fecha uma troca PENDING e devolve tudo que ela segurava: reserva de
 * Cristais e escrow das cartas. Compartilhado por decline/cancel/expire/
 * contraproposta/bloqueio de carta. Idempotente via closed.count !== 1 — e,
 * por isso, sai ANTES de liberar: release não é idempotente.
 */
export async function releaseTrade(
  tx: Prisma.TransactionClient,
  accounting: CrystalAccountingService,
  tradeId: string,
  finalStatus: 'COMPLETED' | 'CANCELLED' | 'EXPIRED',
  closedReason: string,
  actorId?: string | null,
): Promise<boolean> {
  const trade = await tx.gachaTrade.findUnique({
    where: { id: tradeId },
    select: {
      offeredUserId: true,
      requestedUserId: true,
      offeredUserCardId: true,
      requestedUserCardId: true,
      crystalsOffered: true,
      crystalsRequested: true,
      cards: { select: { userCardId: true } },
    },
  });
  if (!trade) return false;
  const closed = await tx.gachaTrade.updateMany({
    where: {
      id: tradeId,
      status: 'PENDING',
      // EXPIRED só se o TTL realmente venceu; senão uma troca viva seria
      // encerrada por um cancelamento que só passou por aqui.
      ...(finalStatus === 'EXPIRED' ? { expiresAt: { lte: new Date() } } : {}),
    },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      closedBy: actorId ?? null,
      closedReason,
    },
  });
  if (closed.count !== 1) return false;
  await accounting.lockWallets(tx, [
    trade.offeredUserId,
    trade.requestedUserId,
  ]);
  if (trade.crystalsOffered > 0) {
    await accounting.release(tx, trade.offeredUserId, trade.crystalsOffered);
  }
  if (trade.crystalsRequested > 0) {
    await accounting.release(
      tx,
      trade.requestedUserId,
      trade.crystalsRequested,
    );
  }
  const cardIds = trade.cards.length
    ? trade.cards.map((c) => c.userCardId)
    : [trade.offeredUserCardId, trade.requestedUserCardId];
  await tx.gachaTradeCard.updateMany({
    where: { tradeId, escrowed: true },
    data: { escrowed: false },
  });
  await tx.userCard.updateMany({
    where: { id: { in: cardIds }, status: 'ESCROW' },
    data: { status: 'ACTIVE' },
  });
  return true;
}

/** Cancela as trocas PENDING que seguram uma carta (admin bloqueou a carta). */
export async function releaseTradesForCard(
  tx: Prisma.TransactionClient,
  accounting: CrystalAccountingService,
  cardId: string,
  reason = 'CARD_BLOCKED',
  actorId?: string | null,
) {
  const trades = await tx.gachaTrade.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { offeredUserCardId: cardId },
        { requestedUserCardId: cardId },
        { cards: { some: { userCardId: cardId } } },
      ],
    },
    select: { id: true },
  });
  for (const { id } of trades) {
    await releaseTrade(tx, accounting, id, 'CANCELLED', reason, actorId);
  }
  return trades.length;
}
