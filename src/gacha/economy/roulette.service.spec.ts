import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';
import { EconomyService } from '@/gacha/economy/economy.service';
import { RouletteService } from '@/gacha/economy/roulette.service';
import { GachaConfigService } from '@/gacha/gacha-config.service';
import { DEFAULT_ROULETTE_PRIZES } from '@/gacha/gacha.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { createTransactionAwarePrismaMock } from '@test/gacha/transaction-prisma.mock';

describe('RouletteService', () => {
  let service: RouletteService;

  const mockConfig = {
    rouletteEnabled: true,
    rouletteSpinDropChance: 4.5,
    roulettePrizes: DEFAULT_ROULETTE_PRIZES,
    foilWeights: { NORMAL: 79, HOLO: 12, GOLD: 3, INK: 3, PRISM: 3 },
    baseValue: {
      COMUM: 10,
      INCOMUM: 25,
      RARA: 60,
      EPICA: 150,
      LENDARIA: 400,
      MITICA: 800,
      GALACTICA: 1600,
    },
    foilMult: { NORMAL: 1, HOLO: 3, GOLD: 10, INK: 10, PRISM: 5 },
    update: jest.fn(),
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    gachaInventory: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    gachaRouletteSpin: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    crystalEvent: {
      findMany: jest.fn(),
    },
    gachaAdminChange: {
      create: jest.fn(),
    },
    card: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    userCard: {
      create: jest.fn(),
    },
    gachaCardDiscovery: {
      createMany: jest.fn(),
    },
    gachaSkin: {
      findMany: jest.fn(),
    },
    userGachaSkin: {
      create: jest.fn(),
    },
    gachaCardBack: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const prismaMocks = createTransactionAwarePrismaMock(mockPrisma);

  const mockEconomy = {
    inventory: jest.fn(),
  };

  const mockCrystals = {
    credit: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMocks.reset();
    mockConfig.rouletteEnabled = true;
    mockConfig.rouletteSpinDropChance = 4.5;
    mockConfig.roulettePrizes = DEFAULT_ROULETTE_PRIZES;

    mockPrisma.$queryRaw.mockResolvedValue([{ quantity: 0n }]);
    mockPrisma.gachaInventory.upsert.mockResolvedValue({
      userId: 'u1',
      rouletteSpins: 3,
    });
    mockPrisma.gachaInventory.findUnique.mockResolvedValue({
      userId: 'u1',
      rouletteSpins: 3,
    });
    mockPrisma.gachaInventory.findUniqueOrThrow.mockResolvedValue({
      rouletteSpins: 3,
    });
    mockPrisma.gachaInventory.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.gachaRouletteSpin.findUnique.mockResolvedValue(null);
    mockPrisma.gachaRouletteSpin.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'rspin-1',
          createdAt: new Date('2026-11-28T15:00:00Z'),
          ...args.data,
        }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouletteService,
        { provide: PrismaService, useValue: prismaMocks.root },
        { provide: GachaConfigService, useValue: mockConfig },
        { provide: CrystalAccountingService, useValue: mockCrystals },
        { provide: EconomyService, useValue: mockEconomy },
      ],
    }).compile();

    service = module.get<RouletteService>(RouletteService);
  });

  describe('getRewardsHub', () => {
    it('não expõe peso, probabilidade ou raridade nas fatias da roleta', async () => {
      mockEconomy.inventory.mockResolvedValue({
        rouletteSpins: 2,
        dailyClaimedToday: false,
        weeklyRewardReady: true,
      });
      mockPrisma.gachaRouletteSpin.findMany.mockResolvedValue([]);
      mockPrisma.crystalEvent.findMany.mockResolvedValue([]);

      const hub = await service.getRewardsHub('u1');

      expect(hub.enabled).toBe(true);
      expect(hub.spinsAvailable).toBe(2);
      expect(hub.pendingCount).toBe(4);
      expect(hub.wheelPrizes.length).toBe(DEFAULT_ROULETTE_PRIZES.length);
      for (const slice of hub.wheelPrizes) {
        expect(slice).not.toHaveProperty('weight');
        expect(slice).not.toHaveProperty('probabilityPct');
        expect(slice).not.toHaveProperty('rarity');
      }
    });
  });

  describe('spinRoulette', () => {
    it('consome 1 giro e credita o prêmio sorteado no backend', async () => {
      mockConfig.roulettePrizes = [
        {
          id: 'crystals_120',
          label: '120 Cristais',
          category: 'CRYSTAL',
          itemId: null,
          quantity: 120,
          weight: 100,
          enabled: true,
        },
      ];

      const result = await service.spinRoulette('u1', 'op-uuid-12345678');

      expect(result.prize.id).toBe('crystals_120');
      expect(result.spinsRemaining).toBe(2);
      expect(mockPrisma.gachaInventory.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', rouletteSpins: { gte: 1 } },
        data: { rouletteSpins: { decrement: 1 } },
      });
      expect(mockCrystals.credit).toHaveBeenCalledWith(
        expect.anything(),
        'u1',
        120,
        'MINT',
        'op-uuid-12345678',
        expect.stringContaining('Roleta de Prêmios'),
      );
    });

    it('credita Essência Exclusiva de Código quando sorteada', async () => {
      mockConfig.roulettePrizes = [
        {
          id: 'code_essence',
          label: 'Essência Exclusiva de Código',
          category: 'ESSENCE',
          itemId: 'ESSENCIA_GALACTICA',
          quantity: 1,
          weight: 100,
          enabled: true,
        },
      ];

      const result = await service.spinRoulette('u1', 'op-uuid-essence-1');

      expect(result.prize.category).toBe('ESSENCE');
      expect(result.prize.itemId).toBe('ESSENCIA_GALACTICA');
      expect(mockPrisma.gachaInventory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { essenciaGalactica: { increment: 1 } },
        }),
      );
    });

    it('retorna resultado idempotente em retentativa com mesmo operationId', async () => {
      mockPrisma.gachaRouletteSpin.findUnique.mockResolvedValue({
        id: 'rspin-existing',
        userId: 'u1',
        operationId: 'op-retry-12345678',
        prizeId: 'crystals_120',
        prizeLabel: '120 Cristais',
        category: 'CRYSTAL',
        itemId: null,
        quantity: 120,
        reward: { category: 'CRYSTAL', amount: 120 },
        createdAt: new Date('2026-11-28T15:00:00Z'),
      });

      const result = await service.spinRoulette('u1', 'op-retry-12345678');

      expect(result.spinId).toBe('rspin-existing');
      expect(mockPrisma.gachaInventory.updateMany).not.toHaveBeenCalled();
      expect(mockCrystals.credit).not.toHaveBeenCalled();
    });

    it('rejeita quando jogador não possui giros disponíveis', async () => {
      mockPrisma.gachaInventory.findUniqueOrThrow.mockResolvedValue({
        rouletteSpins: 0,
      });

      await expect(
        service.spinRoulette('u1', 'op-empty-12345678'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita quando a roleta está desativada', async () => {
      mockConfig.rouletteEnabled = false;

      await expect(
        service.spinRoulette('u1', 'op-disabled-123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('adminGrantRouletteSpins', () => {
    it('concede giros manualmente e registra auditoria', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.gachaInventory.findUniqueOrThrow.mockResolvedValue({
        rouletteSpins: 2,
      });

      const res = await service.adminGrantRouletteSpins(
        'u1',
        'admin-1',
        5,
        'Compensação evento',
      );

      expect(res.rouletteSpins).toBe(7);
      expect(mockPrisma.gachaInventory.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { rouletteSpins: 7 },
      });
      expect(mockPrisma.gachaAdminChange.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'GRANT_ROULETTE_SPINS',
            adminId: 'admin-1',
          }),
        }),
      );
    });

    it('rejeita quando usuário não existe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.adminGrantRouletteSpins('missing', 'admin-1', 1, 'Teste'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
