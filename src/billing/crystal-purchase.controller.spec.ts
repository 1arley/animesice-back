import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  CrystalPurchaseController,
  LivePixCrystalWebhook,
} from './crystal-purchase.controller';
import { CrystalPurchaseService } from './crystal-purchase.service';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('CrystalPurchaseController', () => {
  let controller: CrystalPurchaseController;
  const mockPurchases = {
    checkout: jest.fn(),
    assertWebhookSecret: jest.fn(),
    settle: jest.fn(),
    reverse: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CrystalPurchaseController],
      providers: [{ provide: CrystalPurchaseService, useValue: mockPurchases }],
    }).compile();

    controller = module.get(CrystalPurchaseController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('checkout', () => {
    it('delegates to service with user id and dto', async () => {
      const req = { user: { id: 'user-1' } } as AuthenticatedRequest;
      const dto = { packageId: 'pkg-1', idempotencyKey: 'key-1' };
      mockPurchases.checkout.mockResolvedValue({ id: 'pur-1' });

      const result = await controller.checkout(req, dto as any);

      expect(mockPurchases.checkout).toHaveBeenCalledWith(
        'user-1',
        'pkg-1',
        'key-1',
      );
      expect(result).toEqual({ id: 'pur-1' });
    });
  });

  describe('webhook', () => {
    it('calls settle for payment.completed event', async () => {
      const body: LivePixCrystalWebhook = {
        event: 'payment.completed',
        resource: { reference: 'ref-1' },
      };
      mockPurchases.settle.mockResolvedValue({ status: 'PAID' });

      await controller.webhook('valid-secret', body);

      expect(mockPurchases.assertWebhookSecret).toHaveBeenCalledWith(
        'valid-secret',
      );
      expect(mockPurchases.settle).toHaveBeenCalledWith('ref-1');
      expect(mockPurchases.reverse).not.toHaveBeenCalled();
    });

    it('calls reverse for payment.reversed event', async () => {
      const body: LivePixCrystalWebhook = {
        event: 'payment.reversed',
        resource: { reference: 'ref-2' },
      };
      mockPurchases.reverse.mockResolvedValue({ status: 'REVERSED' });

      await controller.webhook('valid-secret', body);

      expect(mockPurchases.reverse).toHaveBeenCalledWith('ref-2');
      expect(mockPurchases.settle).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if reference is missing', () => {
      const body: LivePixCrystalWebhook = {
        event: 'payment.completed',
        resource: {},
      };

      expect(() => controller.webhook('secret', body)).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if resource is undefined', () => {
      const body: LivePixCrystalWebhook = { event: 'payment.completed' };

      expect(() => controller.webhook('secret', body)).toThrow(
        BadRequestException,
      );
    });

    it('settle called for unknown event type', async () => {
      const body: LivePixCrystalWebhook = {
        event: 'some.other.event',
        resource: { reference: 'ref-3' },
      };
      mockPurchases.settle.mockResolvedValue({ status: 'PENDING' });

      await controller.webhook('secret', body);

      expect(mockPurchases.settle).toHaveBeenCalledWith('ref-3');
    });
  });
});
