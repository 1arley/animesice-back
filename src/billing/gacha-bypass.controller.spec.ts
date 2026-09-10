import { NotFoundException } from '@nestjs/common';
import { GachaBypassController } from '@/billing/gacha-bypass.controller';
import { GACHA_BYPASS_PRICE_CENTS } from '@/gacha/gacha.constants';

function makeMocks() {
  return {
    gacha: {
      status: jest.fn(),
      unlockClaim: jest.fn(),
    },
    livepix: {
      createBypassCharge: jest.fn(),
      isPaid: jest.fn(),
    },
    prisma: {
      user: { findUnique: jest.fn() },
      gachaBypass: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
    },
    config: {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    },
  };
}

const req = (userId: string) => ({ user: { id: userId } }) as never;

describe('GachaBypassController', () => {
  let controller: GachaBypassController;
  let m: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    m = makeMocks();
    controller = new GachaBypassController(
      m.gacha as never,
      m.livepix as never,
      m.prisma as never,
      m.config as never,
    );
    jest.clearAllMocks();
    m.config.get.mockReturnValue('http://localhost:3000');
    m.prisma.user.findUnique.mockResolvedValue({
      userName: 'u',
      name: 'U',
    });
  });

  describe('create', () => {
    it('retorna alreadyUnlocked sem lock', async () => {
      m.gacha.status.mockResolvedValue({ canClaim: true });

      await expect(controller.create(req('u1'))).resolves.toEqual({
        alreadyUnlocked: true,
      });
      expect(m.livepix.createBypassCharge).not.toHaveBeenCalled();
    });

    it('cria intenção LivePix quando em lock', async () => {
      m.gacha.status.mockResolvedValue({ canClaim: false });
      m.prisma.gachaBypass.findFirst.mockResolvedValue(null);
      m.livepix.createBypassCharge.mockResolvedValue({
        reference: 'ref1',
        checkoutUrl: 'https://checkout.livepix.gg/ref1',
      });

      const result = await controller.create(req('u1'));

      expect(result).toEqual({
        reference: 'ref1',
        checkoutUrl: 'https://checkout.livepix.gg/ref1',
        amountCents: GACHA_BYPASS_PRICE_CENTS,
      });
      expect(m.livepix.createBypassCharge).toHaveBeenCalledWith(
        'u',
        GACHA_BYPASS_PRICE_CENTS,
        'http://localhost:3000/gacha?bypass=pending',
      );
      expect(m.prisma.gachaBypass.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'ref1' },
        }),
      );
    });

    it('intenção paga-não-reconciliada libera direto sem nova cobrança', async () => {
      m.gacha.status.mockResolvedValue({ canClaim: false });
      m.prisma.gachaBypass.findFirst.mockResolvedValue({
        reference: 'old',
        amount: 299,
      });
      m.livepix.isPaid.mockResolvedValue(true);

      await expect(controller.create(req('u1'))).resolves.toEqual({
        unlocked: true,
      });
      expect(m.livepix.createBypassCharge).not.toHaveBeenCalled();
      expect(m.prisma.gachaBypass.updateMany).toHaveBeenCalledWith({
        where: { reference: 'old', status: 'PENDING' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
      expect(m.gacha.unlockClaim).toHaveBeenCalledWith('u1');
    });

    it('intenção pendente antiga é substituída', async () => {
      m.gacha.status.mockResolvedValue({ canClaim: false });
      m.prisma.gachaBypass.findFirst.mockResolvedValue({
        reference: 'old',
        amount: 299,
      });
      m.livepix.isPaid.mockResolvedValue(false);
      m.livepix.createBypassCharge.mockResolvedValue({
        reference: 'new',
        checkoutUrl: 'https://checkout.livepix.gg/new',
      });

      const result = await controller.create(req('u1'));

      expect(m.prisma.gachaBypass.delete).toHaveBeenCalledWith({
        where: { reference: 'old' },
      });
      expect(result).toMatchObject({ reference: 'new' });
    });
  });

  describe('poll', () => {
    it('404 para referência de outro usuário', async () => {
      m.prisma.gachaBypass.findFirst.mockResolvedValue(null);

      await expect(controller.poll(req('u1'), 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('retorna PAID direto quando já liquidado', async () => {
      m.prisma.gachaBypass.findFirst.mockResolvedValue({
        reference: 'r',
        userId: 'u1',
        amount: 299,
        status: 'PAID',
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(controller.poll(req('u1'), 'r')).resolves.toEqual({
        status: 'PAID',
      });
      expect(m.livepix.isPaid).not.toHaveBeenCalled();
    });

    it('expirada retorna EXPIRED sem checar LivePix', async () => {
      m.prisma.gachaBypass.findFirst.mockResolvedValue({
        reference: 'r',
        userId: 'u1',
        amount: 299,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(controller.poll(req('u1'), 'r')).resolves.toEqual({
        status: 'EXPIRED',
      });
      expect(m.livepix.isPaid).not.toHaveBeenCalled();
    });

    it('pagamento confirmado liquida e libera claim', async () => {
      m.prisma.gachaBypass.findFirst.mockResolvedValue({
        reference: 'r',
        userId: 'u1',
        amount: 299,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });
      m.livepix.isPaid.mockResolvedValue(true);

      await expect(controller.poll(req('u1'), 'r')).resolves.toEqual({
        status: 'PAID',
      });
      expect(m.gacha.unlockClaim).toHaveBeenCalledWith('u1');
    });

    it('pendente segue PENDING sem liberar', async () => {
      m.prisma.gachaBypass.findFirst.mockResolvedValue({
        reference: 'r',
        userId: 'u1',
        amount: 299,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });
      m.livepix.isPaid.mockResolvedValue(false);

      await expect(controller.poll(req('u1'), 'r')).resolves.toEqual({
        status: 'PENDING',
      });
      expect(m.gacha.unlockClaim).not.toHaveBeenCalled();
    });
  });

  describe('webhook', () => {
    it('ignora sem reference', async () => {
      await expect(controller.webhook({})).resolves.toEqual({ ok: true });
      expect(m.prisma.gachaBypass.findUnique).not.toHaveBeenCalled();
    });

    it('ignora intenção inexistente ou já paga', async () => {
      m.prisma.gachaBypass.findUnique.mockResolvedValue(null);
      await expect(
        controller.webhook({ resource: { reference: 'x' } }),
      ).resolves.toEqual({ ok: true });

      m.prisma.gachaBypass.findUnique.mockResolvedValue({ status: 'PAID' });
      await expect(
        controller.webhook({ resource: { reference: 'x' } }),
      ).resolves.toEqual({ ok: true });
      expect(m.livepix.isPaid).not.toHaveBeenCalled();
    });

    it('valida contra API antes de liberar (webhook é só gatilho)', async () => {
      m.prisma.gachaBypass.findUnique.mockResolvedValue({
        reference: 'r',
        userId: 'u1',
        amount: 299,
        status: 'PENDING',
      });
      m.livepix.isPaid.mockResolvedValue(true);

      await expect(
        controller.webhook({ resource: { reference: 'r' } }),
      ).resolves.toEqual({ ok: true });
      expect(m.livepix.isPaid).toHaveBeenCalledWith('r', 299);
      expect(m.gacha.unlockClaim).toHaveBeenCalledWith('u1');
    });

    it('não libera quando API não confirma', async () => {
      m.prisma.gachaBypass.findUnique.mockResolvedValue({
        reference: 'r',
        userId: 'u1',
        amount: 299,
        status: 'PENDING',
      });
      m.livepix.isPaid.mockResolvedValue(false);

      await expect(
        controller.webhook({ resource: { reference: 'r' } }),
      ).resolves.toEqual({ ok: true });
      expect(m.gacha.unlockClaim).not.toHaveBeenCalled();
    });
  });
});
