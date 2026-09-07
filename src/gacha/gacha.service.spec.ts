import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GachaService } from '@/gacha/gacha.service';
import { PrismaService } from '@/prisma/prisma.service';
import { TurnstileService } from '@/auth/turnstile/turnstile.service';
import {
  cardValue,
  conditionLabel,
  isEpicTier,
  pickWeighted,
} from '@/gacha/gacha.constants';

describe('GachaService', () => {
  let service: GachaService;

  const mockTurnstile = { verify: jest.fn().mockResolvedValue(undefined) };

  const mockPrisma = {
    userWaifu: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    waifu: { count: jest.fn(), findFirst: jest.fn() },
    privacySettings: { findUnique: jest.fn() },
    post: { create: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const waifuComum = {
    id: 'w1',
    name: 'Waifu Comum',
    image: 'https://cdn.anilist.co/img/w1.jpg',
    rarity: 'COMUM',
    favourites: 100,
    animeId: 'a1',
    animeTitle: 'Anime 1',
  };

  const waifuEpica = {
    ...waifuComum,
    id: 'w2',
    name: 'Waifu Épica',
    rarity: 'EPICA',
    favourites: 5000,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockTurnstile.verify.mockResolvedValue(undefined);
    mockPrisma.$transaction.mockImplementation((promises: Promise<unknown>[]) =>
      Promise.all(promises),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GachaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TurnstileService, useValue: mockTurnstile },
      ],
    }).compile();

    service = module.get<GachaService>(GachaService);
  });

  describe('status', () => {
    it('libera roll com pity cheio quando nunca rolou', async () => {
      mockPrisma.userWaifu.count.mockResolvedValue(0);
      mockPrisma.userWaifu.findFirst.mockResolvedValue(null);

      const result = await service.status('u1');

      expect(result.canRoll).toBe(true);
      expect(result.rollsLeft).toBe(1);
      expect(result.nextRollAt).toBeNull();
      expect(result.pityDaysLeft).toBe(30);
      expect(result.pityDue).toBe(false);
    });

    it('bloqueia segundo roll no mesmo dia com nextRollAt', async () => {
      mockPrisma.userWaifu.count.mockResolvedValue(1);
      mockPrisma.userWaifu.findFirst.mockResolvedValue({
        obtainedAt: new Date(),
      });

      const result = await service.status('u1');

      expect(result.canRoll).toBe(false);
      expect(result.rollsLeft).toBe(0);
      expect(result.nextRollAt).not.toBeNull();
    });

    it('marca pityDue após 30 dias sem Épica+', async () => {
      const old = new Date(Date.now() - 40 * 86_400_000);
      mockPrisma.userWaifu.count.mockResolvedValue(0);
      mockPrisma.userWaifu.findFirst.mockResolvedValue({ obtainedAt: old });

      const result = await service.status('u1');

      expect(result.pityDue).toBe(true);
      expect(result.pityDaysLeft).toBe(0);
    });
  });

  describe('roll', () => {
    function stockOnly(rarity: string, size = 5) {
      mockPrisma.waifu.count.mockImplementation(
        (args: { where: { rarity: string } }) =>
          Promise.resolve(args.where.rarity === rarity ? size : 0),
      );
    }

    function freshAccount() {
      mockPrisma.userWaifu.count.mockResolvedValue(0);
      mockPrisma.userWaifu.findFirst.mockResolvedValue(null);
    }

    it('barra roll repetido no dia', async () => {
      mockPrisma.userWaifu.count.mockResolvedValue(1);
      mockPrisma.userWaifu.findFirst.mockResolvedValue({
        obtainedAt: new Date(),
      });

      await expect(service.roll('u1', 'token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockTurnstile.verify).toHaveBeenCalledWith('token');
      expect(mockPrisma.userWaifu.create).not.toHaveBeenCalled();
    });

    it('cria pull COMUM sem post no feed', async () => {
      freshAccount();
      stockOnly('COMUM');
      mockPrisma.waifu.findFirst.mockResolvedValue(waifuComum);
      mockPrisma.userWaifu.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p1',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          waifu: waifuComum,
          ...args.data,
        }),
      );

      const pull = await service.roll('u1');

      expect(pull.waifu.id).toBe('w1');
      expect(pull.edition).toBe(1);
      expect(pull.conditionLabel).toBeDefined();
      expect(mockPrisma.post.create).not.toHaveBeenCalled();
    });

    it('publica Épica+ no feed quando privacidade permite', async () => {
      freshAccount();
      stockOnly('EPICA');
      mockPrisma.waifu.findFirst.mockResolvedValue(waifuEpica);
      mockPrisma.userWaifu.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p2',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          waifu: waifuEpica,
          ...args.data,
        }),
      );
      mockPrisma.privacySettings.findUnique.mockResolvedValue({
        showGacha: true,
      });
      mockPrisma.post.create.mockResolvedValue({ id: 'post1' });

      const pull = await service.roll('u1');

      expect(pull.waifu.rarity).toBe('EPICA');
      expect(mockPrisma.post.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', kind: 'GACHA_PULL' }),
        }),
      );
    });

    it('pula feed quando usuário escondeu pulls', async () => {
      freshAccount();
      stockOnly('EPICA');
      mockPrisma.waifu.findFirst.mockResolvedValue(waifuEpica);
      mockPrisma.userWaifu.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p3',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          waifu: waifuEpica,
          ...args.data,
        }),
      );
      mockPrisma.privacySettings.findUnique.mockResolvedValue({
        showGacha: false,
      });

      await service.roll('u1');

      expect(mockPrisma.post.create).not.toHaveBeenCalled();
    });

    it('pity força tier Épica+', async () => {
      const old = new Date(Date.now() - 40 * 86_400_000);
      mockPrisma.userWaifu.count.mockResolvedValue(0);
      mockPrisma.userWaifu.findFirst.mockResolvedValue({ obtainedAt: old });
      stockOnly('LENDARIA');
      mockPrisma.waifu.findFirst.mockResolvedValue({
        ...waifuEpica,
        id: 'w9',
        rarity: 'LENDARIA',
      });
      mockPrisma.userWaifu.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p4',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          waifu: { ...waifuEpica, id: 'w9', rarity: 'LENDARIA' },
          ...args.data,
        }),
      );
      mockPrisma.privacySettings.findUnique.mockResolvedValue(null);

      const pull = await service.roll('u1');

      expect(pull.pityDue).toBe(true);
      expect(pull.waifu.rarity).toBe('LENDARIA');
      expect(mockPrisma.post.create).toHaveBeenCalled();
    });

    it('falha quando pool está vazio', async () => {
      freshAccount();
      mockPrisma.waifu.count.mockResolvedValue(0);

      await expect(service.roll('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('collection', () => {
    it('retorna pulls com stats para o dono', async () => {
      const pull = {
        id: 'p1',
        condition: 0.05,
        foil: 'HOLO',
        edition: 1,
        value: 100,
        obtainedAt: new Date(),
        waifu: waifuComum,
      };
      mockPrisma.userWaifu.findMany.mockResolvedValue([pull]);
      mockPrisma.userWaifu.count.mockResolvedValue(1);
      mockPrisma.userWaifu.aggregate.mockResolvedValue({
        _sum: { value: 100 },
      });

      const result = await service.collection('u1', 'u1');

      expect(result.data[0]?.conditionLabel).toBe('MINT');
      expect(result.stats).toEqual({ total: 1, totalValue: 100 });
      expect(result.meta.totalPages).toBe(1);
    });

    it('barra visitante quando coleção é privada', async () => {
      mockPrisma.privacySettings.findUnique.mockResolvedValue({
        showGacha: false,
      });

      await expect(service.collection('u2', 'u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('permite visitante quando privacidade ausente (público)', async () => {
      mockPrisma.privacySettings.findUnique.mockResolvedValue(null);
      mockPrisma.userWaifu.findMany.mockResolvedValue([]);
      mockPrisma.userWaifu.count.mockResolvedValue(0);
      mockPrisma.userWaifu.aggregate.mockResolvedValue({
        _sum: { value: null },
      });

      const result = await service.collection('u2', 'u1');

      expect(result.stats).toEqual({ total: 0, totalValue: 0 });
    });
  });

  describe('recent', () => {
    it('filtra quem escondeu pulls e remove privacidade do payload', async () => {
      const base = {
        id: 'p1',
        condition: 0.5,
        foil: 'NORMAL',
        edition: 7,
        value: 12,
        obtainedAt: new Date(),
        waifu: waifuComum,
      };
      mockPrisma.userWaifu.findMany.mockResolvedValue([
        {
          ...base,
          id: 'hidden',
          user: {
            id: 'u2',
            name: 'B',
            userName: 'b',
            avatar: null,
            privacySettings: { showGacha: false },
          },
        },
        {
          ...base,
          id: 'visible',
          user: {
            id: 'u3',
            name: 'C',
            userName: 'c',
            avatar: null,
            privacySettings: null,
          },
        },
      ]);

      const result = await service.recent(20);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('visible');
      expect(result[0]).not.toHaveProperty('privacySettings');
    });
  });

  describe('ranking', () => {
    it('ordena por valor e respeita opt-out', async () => {
      mockPrisma.userWaifu.groupBy.mockResolvedValue([
        { userId: 'u1', _sum: { value: 500 }, _count: { _all: 3 } },
        { userId: 'u2', _sum: { value: 900 }, _count: { _all: 1 } },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          name: 'A',
          userName: 'a',
          avatar: null,
          privacySettings: null,
        },
        {
          id: 'u2',
          name: 'B',
          userName: 'b',
          avatar: null,
          privacySettings: { showGacha: false },
        },
      ]);

      const result = await service.ranking(20);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        user: { id: 'u1', name: 'A', userName: 'a', avatar: null },
        totalValue: 500,
        pulls: 3,
      });
    });

    it('retorna vazio sem pulls', async () => {
      mockPrisma.userWaifu.groupBy.mockResolvedValue([]);

      await expect(service.ranking()).resolves.toEqual([]);
    });
  });
});

describe('gacha constants', () => {
  it('precifica carta: base × condition × foil + bônus low edition', () => {
    expect(cardValue('COMUM', 0.05, 'NORMAL', 500)).toBe(30);
    expect(cardValue('LENDARIA', 0.05, 'GOLD', 1)).toBe(30000 + 1000);
    expect(cardValue('RARA', 0.9, 'HOLO', 11)).toBe(150);
  });

  it('rotula condition nas fronteiras', () => {
    expect(conditionLabel(0.07)).toBe('MINT');
    expect(conditionLabel(0.071)).toBe('NM');
    expect(conditionLabel(0.9)).toBe('POOR');
  });

  it('sorteio ponderado é determinístico com rand fixo', () => {
    expect(pickWeighted({ A: 50, B: 50 }, 0.1)).toBe('A');
    expect(pickWeighted({ A: 50, B: 50 }, 0.9)).toBe('B');
    expect(pickWeighted({ A: 0, B: 100 }, 0)).toBe('B');
  });

  it('classifica tiers épicos', () => {
    expect(isEpicTier('EPICA')).toBe(true);
    expect(isEpicTier('LENDARIA')).toBe(true);
    expect(isEpicTier('RARA')).toBe(false);
  });
});
