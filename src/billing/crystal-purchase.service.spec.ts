import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrystalPurchaseService } from './crystal-purchase.service';
import { PrismaService } from '@/prisma/prisma.service';
import { LivePixService } from './livepix.service';

describe('CrystalPurchaseService', () => {
  let service: CrystalPurchaseService;

  const mockPrisma = {
    gachaEconomyVersion: { findFirst: jest.fn() },
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    crystalPurchase: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    crystalEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockLivePix = {
    createBypassCharge: jest.fn(),
    isPaid: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrystalPurchaseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LivePixService, useValue: mockLivePix },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(CrystalPurchaseService);
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('http://localhost:3000');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkout', () => {
    const validSnapshot = {
      crystal_packages: {
        'pkg-1': { cents: 499, crystals: 100 },
      },
    };

    beforeEach(() => {
      mockPrisma.gachaEconomyVersion.findFirst.mockResolvedValue({
        snapshot: validSnapshot,
      });
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        name: 'Test User',
        userName: 'testuser',
        crystalBalance: 1000,
        gachaMarketBlockedAt: null,
      });
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue(null);
      mockPrisma.crystalPurchase.create.mockResolvedValue({
        id: 'pur-1',
        packageId: 'pkg-1',
      });
    });

    it('creates purchase and returns livepix checkout', async () => {
      mockLivePix.createBypassCharge.mockResolvedValue({
        reference: 'ref-1',
        checkoutUrl: 'https://pay.example.com',
      });
      mockPrisma.crystalPurchase.update.mockResolvedValue({
        id: 'pur-1',
        reference: 'ref-1',
        checkoutUrl: 'https://pay.example.com',
      });

      await service.checkout('user-1', 'pkg-1', 'key-1');

      expect(mockPrisma.crystalPurchase.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          packageId: 'pkg-1',
          idempotencyKey: 'key-1',
          amountCents: 499,
          crystals: 100,
        },
      });
      expect(mockLivePix.createBypassCharge).toHaveBeenCalledWith(
        'testuser',
        499,
        'http://localhost:3000/gacha/crystals?purchase=pur-1',
      );
    });

    it('throws BadRequestException if package not found', async () => {
      mockPrisma.gachaEconomyVersion.findFirst.mockResolvedValue({
        snapshot: { crystal_packages: {} },
      });

      await expect(
        service.checkout('user-1', 'nonexistent', 'key-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if package has invalid cents', async () => {
      mockPrisma.gachaEconomyVersion.findFirst.mockResolvedValue({
        snapshot: {
          crystal_packages: { bad: { cents: -1, crystals: 100 } },
        },
      });

      await expect(service.checkout('user-1', 'bad', 'key-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if package has invalid crystals', async () => {
      mockPrisma.gachaEconomyVersion.findFirst.mockResolvedValue({
        snapshot: {
          crystal_packages: { bad: { cents: 100, crystals: 0 } },
        },
      });

      await expect(service.checkout('user-1', 'bad', 'key-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException if user is blocked', async () => {
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        name: 'User',
        userName: 'blocked',
        crystalBalance: 1000,
        gachaMarketBlockedAt: new Date(),
      });

      await expect(
        service.checkout('user-1', 'pkg-1', 'key-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if crystal balance is negative', async () => {
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        name: 'User',
        userName: 'user',
        crystalBalance: -100,
        gachaMarketBlockedAt: null,
      });

      await expect(
        service.checkout('user-1', 'pkg-1', 'key-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns existing purchase if idempotency key matches', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue({
        id: 'pur-existing',
        packageId: 'pkg-1',
      });

      const result = await service.checkout('user-1', 'pkg-1', 'key-1');

      expect(result).toEqual({ id: 'pur-existing', packageId: 'pkg-1' });
      expect(mockPrisma.crystalPurchase.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException if idempotency key used for different package', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue({
        id: 'pur-existing',
        packageId: 'pkg-other',
      });

      await expect(
        service.checkout('user-1', 'pkg-1', 'key-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('marks purchase as EXPIRED if livepix call fails', async () => {
      mockLivePix.createBypassCharge.mockRejectedValue(
        new Error('Payment gateway error'),
      );
      mockPrisma.crystalPurchase.update.mockResolvedValue({});

      await expect(
        service.checkout('user-1', 'pkg-1', 'key-1'),
      ).rejects.toThrow('Payment gateway error');

      expect(mockPrisma.crystalPurchase.update).toHaveBeenCalledWith({
        where: { id: 'pur-1' },
        data: { status: 'EXPIRED' },
      });
    });

    it('uses FRONTEND_URL from config if available', async () => {
      mockConfig.get.mockReturnValue('https://app.example.com');
      mockLivePix.createBypassCharge.mockResolvedValue({
        reference: 'ref-2',
        checkoutUrl: 'https://pay.example.com',
      });
      mockPrisma.crystalPurchase.update.mockResolvedValue({});

      await service.checkout('user-1', 'pkg-1', 'key-1');

      expect(mockLivePix.createBypassCharge).toHaveBeenCalledWith(
        'testuser',
        499,
        'https://app.example.com/gacha/crystals?purchase=pur-1',
      );
    });
  });

  describe('settle', () => {
    it('throws NotFoundException if purchase not found', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue(null);

      await expect(service.settle('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns purchase if already paid', async () => {
      const paid = { id: 'pur-1', status: 'PAID' };
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue(paid);

      const result = await service.settle('ref-1');

      expect(result).toEqual(paid);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException if purchase is not pending', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue({
        id: 'pur-1',
        status: 'EXPIRED',
      });

      await expect(service.settle('ref-1')).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException if payment not confirmed by gateway', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue({
        id: 'pur-1',
        status: 'PENDING',
        amountCents: 499,
      });
      mockLivePix.isPaid.mockResolvedValue(false);

      await expect(service.settle('ref-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('completes settle transaction when payment confirmed', async () => {
      const purchase = {
        id: 'pur-1',
        status: 'PENDING',
        amountCents: 499,
        userId: 'user-1',
        crystals: 100,
        packageId: 'pkg-1',
        reference: 'ref-1',
      };
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue(purchase);
      mockLivePix.isPaid.mockResolvedValue(true);

      const mockTx = {
        crystalPurchase: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            ...purchase,
            status: 'PAID',
          }),
        },
        user: { update: jest.fn() },
        crystalEvent: { create: jest.fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await service.settle('ref-1');

      expect(mockTx.crystalPurchase.updateMany).toHaveBeenCalledWith({
        where: { id: 'pur-1', status: 'PENDING' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { crystalBalance: { increment: 100 } },
      });
      expect(mockTx.crystalEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'PURCHASE',
          delta: 100,
          refId: 'pur-1',
          reason: 'Compra pkg-1',
        },
      });
    });

    it('does not increment balance if updateMany count is 0', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue({
        id: 'pur-1',
        status: 'PENDING',
        amountCents: 499,
        userId: 'user-1',
        crystals: 100,
        packageId: 'pkg-1',
      });
      mockLivePix.isPaid.mockResolvedValue(true);

      const mockTx = {
        crystalPurchase: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'pur-1',
            status: 'PAID',
          }),
        },
        user: { update: jest.fn() },
        crystalEvent: { create: jest.fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await service.settle('ref-1');

      expect(mockTx.user.update).not.toHaveBeenCalled();
      expect(mockTx.crystalEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('reverse', () => {
    it('throws NotFoundException if purchase not found', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue(null);

      await expect(service.reverse('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns purchase if already reversed', async () => {
      const reversed = { id: 'pur-1', status: 'REVERSED' };
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue(reversed);

      const result = await service.reverse('ref-1');

      expect(result).toEqual(reversed);
    });

    it('throws ConflictException if purchase is not paid', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue({
        id: 'pur-1',
        status: 'PENDING',
      });

      await expect(service.reverse('ref-1')).rejects.toThrow(ConflictException);
    });

    it('completes reverse transaction for paid purchase', async () => {
      const purchase = {
        id: 'pur-1',
        status: 'PAID',
        userId: 'user-1',
        crystals: 100,
        reference: 'ref-1',
      };
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue(purchase);

      const mockTx = {
        crystalPurchase: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            ...purchase,
            status: 'REVERSED',
          }),
        },
        user: { update: jest.fn() },
        crystalEvent: { create: jest.fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await service.reverse('ref-1');

      expect(mockTx.crystalPurchase.updateMany).toHaveBeenCalledWith({
        where: { id: 'pur-1', status: 'PAID' },
        data: { status: 'REVERSED', reversedAt: expect.any(Date) },
      });
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          crystalBalance: { decrement: 100 },
          gachaMarketBlockedAt: expect.any(Date),
          gachaMarketBlockReason: 'Chargeback ref-1',
        },
      });
      expect(mockTx.crystalEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'CHARGEBACK',
          delta: -100,
          refId: 'pur-1',
          reason: 'Reversão do processador de pagamento',
        },
      });
    });

    it('does not decrement balance if updateMany count is 0', async () => {
      mockPrisma.crystalPurchase.findUnique.mockResolvedValue({
        id: 'pur-1',
        status: 'PAID',
        userId: 'user-1',
        crystals: 100,
        reference: 'ref-1',
      });

      const mockTx = {
        crystalPurchase: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'pur-1',
            status: 'REVERSED',
          }),
        },
        user: { update: jest.fn() },
        crystalEvent: { create: jest.fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await service.reverse('ref-1');

      expect(mockTx.user.update).not.toHaveBeenCalled();
      expect(mockTx.crystalEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('assertWebhookSecret', () => {
    it('throws ForbiddenException if expected secret is not configured', () => {
      mockConfig.get.mockReturnValue(undefined);

      expect(() => service.assertWebhookSecret('anything')).toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException if provided secret does not match', () => {
      mockConfig.get.mockReturnValue('expected-secret');

      expect(() => service.assertWebhookSecret('wrong-secret')).toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException if provided secret is undefined', () => {
      mockConfig.get.mockReturnValue('expected-secret');

      expect(() => service.assertWebhookSecret(undefined)).toThrow(
        ForbiddenException,
      );
    });

    it('does not throw if secrets match', () => {
      mockConfig.get.mockReturnValue('expected-secret');

      expect(() =>
        service.assertWebhookSecret('expected-secret'),
      ).not.toThrow();
    });
  });
});
