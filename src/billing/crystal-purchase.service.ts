import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { LivePixService } from './livepix.service';

@Injectable()
export class CrystalPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livepix: LivePixService,
    private readonly config: ConfigService,
  ) {}

  async checkout(userId: string, packageId: string, idempotencyKey: string) {
    const version = await this.prisma.gachaEconomyVersion.findFirst({
      where: { activeFrom: { lte: new Date() } },
      orderBy: [{ activeFrom: 'desc' }, { version: 'desc' }],
    });
    const snapshot = version?.snapshot as
      | {
          crystal_packages?: Record<
            string,
            { cents: number; crystals: number }
          >;
        }
      | undefined;
    const pack = snapshot?.crystal_packages?.[packageId];
    if (
      !pack ||
      !Number.isSafeInteger(pack.cents) ||
      pack.cents < 1 ||
      pack.cents > 4990 ||
      !Number.isSafeInteger(pack.crystals) ||
      pack.crystals < 1 ||
      pack.crystals > 2_147_483_647
    )
      throw new BadRequestException('Pacote inválido ou indisponível.');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        userName: true,
        crystalBalance: true,
        gachaMarketBlockedAt: true,
      },
    });
    if (user.crystalBalance < 0 || user.gachaMarketBlockedAt) {
      throw new ForbiddenException(
        'Compras bloqueadas até regularização da conta.',
      );
    }
    const existing = await this.prisma.crystalPurchase.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (existing) {
      if (existing.packageId !== packageId) {
        throw new ConflictException(
          'Chave de idempotência já usada em outro pacote.',
        );
      }
      return existing;
    }
    const purchase = await this.prisma.crystalPurchase.create({
      data: {
        userId,
        packageId,
        idempotencyKey,
        amountCents: pack.cents,
        crystals: pack.crystals,
      },
    });
    const frontend =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    try {
      const checkout = await this.livepix.createBypassCharge(
        user.userName ?? user.name ?? userId,
        pack.cents,
        `${frontend.replace(/\/$/, '')}/gacha/crystals?purchase=${purchase.id}`,
      );
      return this.prisma.crystalPurchase.update({
        where: { id: purchase.id },
        data: {
          reference: checkout.reference,
          checkoutUrl: checkout.checkoutUrl,
        },
      });
    } catch (error) {
      await this.prisma.crystalPurchase.update({
        where: { id: purchase.id },
        data: { status: 'EXPIRED' },
      });
      throw error;
    }
  }

  async settle(reference: string) {
    const purchase = await this.prisma.crystalPurchase.findUnique({
      where: { reference },
    });
    if (!purchase) throw new NotFoundException('Compra não encontrada.');
    if (purchase.status === 'PAID') return purchase;
    if (purchase.status !== 'PENDING') {
      throw new ConflictException('Compra não está pendente.');
    }
    if (!(await this.livepix.isPaid(reference, purchase.amountCents))) {
      throw new BadRequestException('Pagamento ainda não confirmado.');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const paid = await tx.crystalPurchase.updateMany({
          where: { id: purchase.id, status: 'PENDING' },
          data: { status: 'PAID', paidAt: new Date() },
        });
        if (paid.count === 1) {
          await tx.user.update({
            where: { id: purchase.userId },
            data: { crystalBalance: { increment: purchase.crystals } },
          });
          await tx.crystalEvent.create({
            data: {
              userId: purchase.userId,
              type: 'PURCHASE',
              delta: purchase.crystals,
              refId: purchase.id,
              reason: `Compra ${purchase.packageId}`,
            },
          });
        }
        return tx.crystalPurchase.findUniqueOrThrow({
          where: { id: purchase.id },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reverse(reference: string) {
    const purchase = await this.prisma.crystalPurchase.findUnique({
      where: { reference },
    });
    if (!purchase) throw new NotFoundException('Compra não encontrada.');
    if (purchase.status === 'REVERSED') return purchase;
    if (purchase.status !== 'PAID') {
      throw new ConflictException('Somente compra paga pode ser revertida.');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const reversed = await tx.crystalPurchase.updateMany({
          where: { id: purchase.id, status: 'PAID' },
          data: { status: 'REVERSED', reversedAt: new Date() },
        });
        if (reversed.count === 1) {
          await tx.user.update({
            where: { id: purchase.userId },
            data: {
              crystalBalance: { decrement: purchase.crystals },
              gachaMarketBlockedAt: new Date(),
              gachaMarketBlockReason: `Chargeback ${purchase.reference ?? purchase.id}`,
            },
          });
          await tx.crystalEvent.create({
            data: {
              userId: purchase.userId,
              type: 'CHARGEBACK',
              delta: -purchase.crystals,
              refId: purchase.id,
              reason: 'Reversão do processador de pagamento',
            },
          });
        }
        return tx.crystalPurchase.findUniqueOrThrow({
          where: { id: purchase.id },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  assertWebhookSecret(value: string | undefined) {
    const expected = this.config.get<string>('LIVEPIX_WEBHOOK_SECRET');
    if (!expected || !value) {
      throw new ForbiddenException('Webhook não autorizado.');
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(value);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Webhook não autorizado.');
    }
  }
}
