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
    userCard: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      delete: jest.fn(),
    },
    gachaRollDay: {
      count: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    card: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    privacySettings: { findUnique: jest.fn() },
    post: { create: jest.fn() },
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const cardComum = {
    id: 'w1',
    name: 'Card Comum',
    image: 'https://cdn.anilist.co/img/w1.jpg',
    rarity: 'COMUM',
    favourites: 100,
    animeId: 'a1',
    animeTitle: 'Anime 1',
  };

  const cardEpica = {
    ...cardComum,
    id: 'w2',
    name: 'Card Épica',
    rarity: 'EPICA',
    favourites: 5000,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockTurnstile.verify.mockResolvedValue(undefined);
    mockPrisma.$transaction.mockImplementation(
      (input: Promise<unknown>[] | ((tx: typeof mockPrisma) => unknown)) =>
        typeof input === 'function' ? input(mockPrisma) : Promise.all(input),
    );
    mockPrisma.gachaRollDay.count.mockResolvedValue(0);
    mockPrisma.card.update.mockResolvedValue({ editionCounter: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GachaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TurnstileService, useValue: mockTurnstile },
      ],
    }).compile();

    service = module.get<GachaService>(GachaService);
  });

  describe('featured cards', () => {
    it('só permite destacar carta própria', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue(null);
      await expect(service.setFeatured('u1', 'foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('retorna 404 para carta pública privada', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue(null);
      await expect(service.publicCard('hidden')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('limpa destaque antes do delete administrativo', async () => {
      mockPrisma.userCard.delete.mockResolvedValue({ id: 'p1' });
      await service.adminDeleteUserCard('p1');
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { featuredUserCardId: 'p1' },
        data: { featuredUserCardId: null },
      });
      expect(mockPrisma.userCard.delete).toHaveBeenCalledWith({
        where: { id: 'p1' },
      });
    });

    it('setFeatured atualiza e retorna destaque', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue({ id: 'p1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        featuredUserCard: null,
      });

      await expect(service.setFeatured('u1', 'p1')).resolves.toBeNull();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { featuredUserCardId: 'p1' },
      });
    });

    it('removeFeatured limpa o destaque', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      await expect(service.removeFeatured('u1')).resolves.toEqual({
        featuredUserCardId: null,
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { featuredUserCardId: null },
      });
    });

    it('featured retorna carta destacada com conditionLabel', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        featuredUserCard: {
          id: 'p1',
          condition: 0.05,
          foil: 'HOLO',
          edition: 1,
          value: 100,
          obtainedAt: new Date(),
          card: cardComum,
        },
      });

      const result = await service.featured('u1');

      expect(result).toMatchObject({ id: 'p1', conditionLabel: 'MINT' });
    });
  });

  describe('status', () => {
    it('libera roll com pity cheio quando nunca rolou', async () => {
      mockPrisma.userCard.count.mockResolvedValue(0);
      mockPrisma.userCard.findFirst.mockResolvedValue(null);

      const result = await service.status('u1');

      expect(result.canRoll).toBe(true);
      expect(result.rollsLeft).toBe(1);
      expect(result.nextRollAt).toBeNull();
      expect(result.pityDaysLeft).toBe(30);
      expect(result.pityDue).toBe(false);
    });

    it('bloqueia segundo roll no mesmo dia com nextRollAt', async () => {
      mockPrisma.gachaRollDay.count.mockResolvedValue(1);
      mockPrisma.userCard.findFirst.mockResolvedValue({
        obtainedAt: new Date(),
      });

      const result = await service.status('u1');

      expect(result.canRoll).toBe(false);
      expect(result.rollsLeft).toBe(0);
      expect(result.nextRollAt).not.toBeNull();
    });

    it('marca pityDue após 30 dias sem Épica+', async () => {
      const old = new Date(Date.now() - 40 * 86_400_000);
      mockPrisma.userCard.count.mockResolvedValue(0);
      mockPrisma.userCard.findFirst.mockResolvedValue({ obtainedAt: old });

      const result = await service.status('u1');

      expect(result.pityDue).toBe(true);
      expect(result.pityDaysLeft).toBe(0);
    });
  });

  describe('roll', () => {
    function stockOnly(rarity: string, size = 5) {
      mockPrisma.card.count.mockImplementation(
        (args: { where: { rarity: string } }) =>
          Promise.resolve(args.where.rarity === rarity ? size : 0),
      );
    }

    function freshAccount() {
      mockPrisma.userCard.count.mockResolvedValue(0);
      mockPrisma.userCard.findFirst.mockResolvedValue(null);
    }

    it('barra roll repetido no dia', async () => {
      mockPrisma.gachaRollDay.count.mockResolvedValue(1);
      mockPrisma.userCard.findFirst.mockResolvedValue({
        obtainedAt: new Date(),
      });

      await expect(service.roll('u1', 'token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockTurnstile.verify).toHaveBeenCalledWith('token');
      expect(mockPrisma.userCard.create).not.toHaveBeenCalled();
    });

    it('cria pull COMUM sem post no feed', async () => {
      freshAccount();
      stockOnly('COMUM');
      mockPrisma.card.findFirst.mockResolvedValue(cardComum);
      mockPrisma.userCard.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p1',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          card: cardComum,
          ...args.data,
        }),
      );

      const pull = await service.roll('u1');

      expect(pull.card.id).toBe('w1');
      expect(pull.edition).toBe(1);
      expect(pull.conditionLabel).toBeDefined();
      expect(mockPrisma.gachaRollDay.create).toHaveBeenCalled();
      expect(mockPrisma.card.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { editionCounter: { increment: 1 } },
        }),
      );
      expect(mockPrisma.post.create).not.toHaveBeenCalled();
    });

    it('publica Épica+ no feed quando privacidade permite', async () => {
      freshAccount();
      stockOnly('EPICA');
      mockPrisma.card.findFirst.mockResolvedValue(cardEpica);
      mockPrisma.userCard.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p2',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          card: cardEpica,
          ...args.data,
        }),
      );
      mockPrisma.privacySettings.findUnique.mockResolvedValue({
        showGacha: true,
      });
      mockPrisma.post.create.mockResolvedValue({ id: 'post1' });

      const pull = await service.roll('u1');

      expect(pull.card.rarity).toBe('EPICA');
      expect(mockPrisma.post.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', kind: 'GACHA_PULL' }),
        }),
      );
    });

    it('pula feed quando usuário escondeu pulls', async () => {
      freshAccount();
      stockOnly('EPICA');
      mockPrisma.card.findFirst.mockResolvedValue(cardEpica);
      mockPrisma.userCard.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p3',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          card: cardEpica,
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
      mockPrisma.userCard.count.mockResolvedValue(0);
      mockPrisma.userCard.findFirst.mockResolvedValue({ obtainedAt: old });
      stockOnly('LENDARIA');
      mockPrisma.card.findFirst.mockResolvedValue({
        ...cardEpica,
        id: 'w9',
        rarity: 'LENDARIA',
      });
      mockPrisma.userCard.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p4',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          card: { ...cardEpica, id: 'w9', rarity: 'LENDARIA' },
          ...args.data,
        }),
      );
      mockPrisma.privacySettings.findUnique.mockResolvedValue(null);

      const pull = await service.roll('u1');

      expect(pull.pityDue).toBe(true);
      expect(pull.card.rarity).toBe('LENDARIA');
      expect(mockPrisma.post.create).toHaveBeenCalled();
    });

    it('falha quando pool está vazio', async () => {
      freshAccount();
      mockPrisma.card.count.mockResolvedValue(0);

      await expect(service.roll('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejeita P2002 como ForbiddenException', async () => {
      freshAccount();
      stockOnly('COMUM');
      mockPrisma.card.findFirst.mockResolvedValue(cardComum);
      mockPrisma.userCard.create.mockRejectedValueOnce({ code: 'P2002' });

      await expect(service.roll('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('mantém roll Épica+ mesmo quando post falha', async () => {
      freshAccount();
      stockOnly('EPICA');
      mockPrisma.card.findFirst.mockResolvedValue(cardEpica);
      mockPrisma.userCard.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 'p9',
          obtainedAt: new Date(),
          user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
          card: cardEpica,
          ...args.data,
        }),
      );
      mockPrisma.privacySettings.findUnique.mockResolvedValue(null);
      mockPrisma.post.create.mockRejectedValue(new Error('boom'));

      const consoleWarn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      const pull = await service.roll('u1');

      expect(pull.card.rarity).toBe('EPICA');
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('publishPullPost falhou'),
      );
      consoleWarn.mockRestore();
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
        card: cardComum,
      };
      mockPrisma.userCard.findMany.mockResolvedValue([pull]);
      mockPrisma.userCard.count.mockResolvedValue(1);
      mockPrisma.userCard.aggregate.mockResolvedValue({
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
      mockPrisma.userCard.findMany.mockResolvedValue([]);
      mockPrisma.userCard.count.mockResolvedValue(0);
      mockPrisma.userCard.aggregate.mockResolvedValue({
        _sum: { value: null },
      });

      const result = await service.collection('u2', 'u1');

      expect(result.stats).toEqual({ total: 0, totalValue: 0 });
    });

    it('aplica filtros, ordenação e limites seguros', async () => {
      mockPrisma.userCard.findMany.mockResolvedValue([]);
      mockPrisma.userCard.count.mockResolvedValue(0);
      mockPrisma.userCard.aggregate.mockResolvedValue({ _sum: { value: 0 } });

      await service.collection('u1', 'u1', -2, 999, 'recent', 'RARA', 'HOLO');

      expect(mockPrisma.userCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', card: { rarity: 'RARA' }, foil: 'HOLO' },
          skip: 0,
          take: 100,
          orderBy: { obtainedAt: 'desc' },
        }),
      );
    });

    it('permite visitante quando coleção visível e ordena por raridade', async () => {
      mockPrisma.privacySettings.findUnique.mockResolvedValue({
        showGacha: true,
      });
      mockPrisma.userCard.findMany.mockResolvedValue([]);
      mockPrisma.userCard.count.mockResolvedValue(0);
      mockPrisma.userCard.aggregate.mockResolvedValue({ _sum: { value: 0 } });

      await service.collection(
        'u2',
        'u1',
        1,
        10,
        'rarity',
        'INVALIDA',
        'OUTRO',
      );

      expect(mockPrisma.privacySettings.findUnique).toHaveBeenCalled();
      expect(mockPrisma.userCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u2' },
          orderBy: { card: { rarity: 'desc' } },
        }),
      );
    });

    it('ordena por edição quando solicitado', async () => {
      mockPrisma.userCard.findMany.mockResolvedValue([]);
      mockPrisma.userCard.count.mockResolvedValue(0);
      mockPrisma.userCard.aggregate.mockResolvedValue({ _sum: { value: 0 } });

      await service.collection('u1', 'u1', 1, 10, 'edition');

      expect(mockPrisma.userCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { edition: 'asc' } }),
      );
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
        card: cardComum,
      };
      mockPrisma.userCard.findMany.mockResolvedValue([
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
      mockPrisma.userCard.groupBy.mockResolvedValue([
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
      mockPrisma.userCard.groupBy.mockResolvedValue([]);

      await expect(service.ranking()).resolves.toEqual([]);
    });
  });

  describe('public featured and ranking', () => {
    it('publicFeatured retorna carta visível', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        featuredUserCard: {
          id: 'p1',
          condition: 0.5,
          foil: 'NORMAL',
          edition: 1,
          value: 10,
          obtainedAt: new Date(),
          card: cardComum,
        },
      });

      const result = await service.publicFeatured('u1');

      expect(result).toMatchObject({ id: 'p1', conditionLabel: 'PLAYED' });
    });

    it('publicFeatured 404 para usuário privado', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.publicFeatured('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('ranking descarta usuário inexistente', async () => {
      mockPrisma.userCard.groupBy.mockResolvedValue([
        { userId: 'ghost', _sum: { value: 10 }, _count: { _all: 1 } },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      await expect(service.ranking()).resolves.toEqual([]);
    });

    it('adminGrantUserCard cria carta concedida', async () => {
      mockPrisma.card.findUnique.mockResolvedValue({
        id: 'c1',
        rarity: 'RARA',
        editionCounter: 5,
      });
      mockPrisma.card.update.mockResolvedValue({ editionCounter: 6 });
      mockPrisma.userCard.create.mockResolvedValue({ id: 'p10' });

      await expect(service.adminGrantUserCard('u1', 'c1')).resolves.toEqual({
        id: 'p10',
      });
      expect(mockPrisma.card.findUnique).toHaveBeenCalledWith({
        where: { id: 'c1' },
        select: { id: true, rarity: true, editionCounter: true },
      });
    });

    it('adminGrantUserCard 404 sem carta', async () => {
      mockPrisma.card.findUnique.mockResolvedValue(null);
      await expect(
        service.adminGrantUserCard('u1', 'x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('delega administrativo simples', async () => {
      mockPrisma.card.findMany.mockResolvedValue([]);
      mockPrisma.card.count.mockResolvedValue(0);

      await service.adminCards(1, 10, 'busca', 'COMUM');
      expect(mockPrisma.card.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            name: { contains: 'busca', mode: 'insensitive' },
            rarity: 'COMUM',
          },
        }),
      );

      await service.adminUpdateCard('c1', { name: 'Novo' });
      expect(mockPrisma.card.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: 'Novo' },
      });

      await service.adminUserCards('u1', 1, 10);
      expect(mockPrisma.userCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );

      await service.adminResetRoll('u1');
      expect(mockPrisma.gachaRollDay.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', day: expect.any(Date) },
      });
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
