import { BadRequestException, Injectable } from '@nestjs/common';
import { CrystalEventType, Prisma } from '@prisma/client';

const MAX_CRYSTALS = 2_147_483_647;

@Injectable()
export class CrystalAccountingService {
  async change(
    tx: Prisma.TransactionClient,
    userId: string,
    delta: number,
    type: CrystalEventType,
    refId: string | null,
    reason: string,
  ) {
    this.assertAmount(Math.abs(delta), true);
    if (delta < 0) {
      return this.debitAvailable(
        tx,
        userId,
        -delta,
        type,
        refId,
        reason,
        'Crystals insuficientes.',
      );
    }
    return this.credit(tx, userId, delta, type, refId, reason);
  }

  async debitAvailable(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    type: CrystalEventType,
    refId: string | null | undefined,
    reason: string,
    insufficientMessage = 'Crystal disponível insuficiente.',
  ) {
    this.assertAmount(amount);
    await this.lockWallet(tx, userId);
    const wallet = await tx.user.findUnique({
      where: { id: userId },
      select: { crystalBalance: true, crystalReserved: true },
    });
    if (!wallet || wallet.crystalBalance - wallet.crystalReserved < amount) {
      throw new BadRequestException(insufficientMessage);
    }
    await tx.user.update({
      where: { id: userId },
      data: { crystalBalance: { decrement: amount } },
    });
    return tx.crystalEvent.create({
      data: { userId, delta: -amount, type, refId, reason },
    });
  }

  async credit(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    type: CrystalEventType,
    refId: string | null | undefined,
    reason: string,
  ) {
    this.assertAmount(amount);
    const changed = await tx.user.updateMany({
      where: { id: userId, crystalBalance: { lte: MAX_CRYSTALS - amount } },
      data: { crystalBalance: { increment: amount } },
    });
    if (changed.count !== 1) {
      throw new BadRequestException('Limite de Crystals excedido.');
    }
    return tx.crystalEvent.create({
      data: { userId, delta: amount, type, refId, reason },
    });
  }

  async reserve(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    insufficientMessage = 'Crystal disponível insuficiente.',
  ) {
    this.assertAmount(amount);
    await this.lockWallet(tx, userId);
    const wallet = await tx.user.findUnique({
      where: { id: userId },
      select: { crystalBalance: true, crystalReserved: true },
    });
    if (!wallet || wallet.crystalBalance - wallet.crystalReserved < amount) {
      throw new BadRequestException(insufficientMessage);
    }
    await tx.user.update({
      where: { id: userId },
      data: { crystalReserved: { increment: amount } },
    });
  }

  async release(tx: Prisma.TransactionClient, userId: string, amount: number) {
    this.assertAmount(amount);
    await this.lockWallet(tx, userId);
    const released = await tx.user.updateMany({
      where: { id: userId, crystalReserved: { gte: amount } },
      data: { crystalReserved: { decrement: amount } },
    });
    if (released.count !== 1) {
      throw new BadRequestException('Reserva de Crystal inconsistente.');
    }
  }

  async consumeReserved(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    type: CrystalEventType,
    refId: string | null | undefined,
    reason: string,
  ) {
    this.assertAmount(amount);
    await this.lockWallet(tx, userId);
    const consumed = await tx.user.updateMany({
      where: {
        id: userId,
        crystalBalance: { gte: amount },
        crystalReserved: { gte: amount },
      },
      data: {
        crystalBalance: { decrement: amount },
        crystalReserved: { decrement: amount },
      },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException('Reserva de Crystal inconsistente.');
    }
    return tx.crystalEvent.create({
      data: { userId, delta: -amount, type, refId, reason },
    });
  }

  private assertAmount(amount: number, allowZero = false) {
    if (
      !Number.isSafeInteger(amount) ||
      amount < (allowZero ? 0 : 1) ||
      amount > MAX_CRYSTALS
    ) {
      throw new BadRequestException('Valor de Crystal inválido.');
    }
  }

  private async lockWallet(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  }
}
