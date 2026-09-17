import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GachaService } from '@/gacha/gacha.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
  cardValue,
  conditionLabel,
  isEpicTier,
  pickWeighted,
} from '@/gacha/gacha.constants';

describe('GachaService', () => {
  let service: GachaService;

  const mockPrisma = {
    crystalEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    gachaDailyBonus: { createMany: jest.fn(), updateMany: jest.fn() },
    userCard: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      delete: jest.fn(),
    },
    gachaTrade: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    gachaRollDay: {
      count: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    gachaSpin: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
    },
    gachaClaimLock: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    gachaBypass: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    gachaPointEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    gachaListing: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
    notification: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    gachaCardBack: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    gachaCollection: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    gachaRarity: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    gachaSkin: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userGachaSkin: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    gachaAdminChange: {
      create: jest.fn(),
      findMany: jest.fn(),
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

  function mockPullCreate(pullId = 'p1', rarity: string = 'COMUM') {
    mockPrisma.userCard.create.mockImplementation((args: { data: object }) =>
      Promise.resolve({
        id: pullId,
        obtainedAt: new Date(),
        user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
        card: { ...cardComum, rarity },
        ...args.data,
      }),
    );
    mockPrisma.gachaSpin.update.mockResolvedValue({});
    mockPrisma.gachaSpin.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.gachaClaimLock.upsert.mockResolvedValue({});
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ crystalBalance: 0 });
    mockPrisma.crystalEvent.findMany.mockResolvedValue([]);
    mockPrisma.crystalEvent.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockImplementation(
      (input: Promise<unknown>[] | ((tx: typeof mockPrisma) => unknown)) =>
        typeof input === 'function' ? input(mockPrisma) : Promise.all(input),
    );
    mockPrisma.gachaRollDay.count.mockResolvedValue(0);
    mockPrisma.gachaSpin.count.mockResolvedValue(0);
    mockPrisma.card.count.mockResolvedValue(0);
    mockPrisma.userCard.findMany.mockResolvedValue([]);
    mockPrisma.gachaTrade.count.mockResolvedValue(0);
    mockPrisma.gachaTrade.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.userCard.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.gachaClaimLock.findUnique.mockResolvedValue(null);
    mockPrisma.card.update.mockResolvedValue({ editionCounter: 1 });
    mockPrisma.userCard.aggregate.mockResolvedValue({ _sum: { value: 0 } });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GachaService,
        { provide: PrismaService, useValue: mockPrisma },
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
    it('libera spin e claim com pity inicial', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue(null);

      const result = await service.status('u1');

      expect(result.canSpin).toBe(true);
      expect(result.spinsLeft).toBe(5);
      expect(result.nextSpinAt).toBeNull();
      expect(result.canClaim).toBe(true);
      expect(result.nextClaimAt).toBeNull();
      expect(result.claimWarning).toBeNull();
      expect(result.bypassPriceCents).toBeNull();
      expect(result.pityDaysLeft).toBe(30);
      expect(result.pityDue).toBe(false);
    });

    it('esgota spins da hora com nextSpinAt', async () => {
      mockPrisma.gachaSpin.count.mockResolvedValue(5);
      mockPrisma.userCard.findFirst.mockResolvedValue({
        obtainedAt: new Date(),
      });

      const result = await service.status('u1');

      expect(result.canSpin).toBe(false);
      expect(result.spinsLeft).toBe(0);
      expect(result.nextSpinAt).not.toBeNull();
    });

    it('marca lock de claim com aviso e preço de bypass', async () => {
      mockPrisma.gachaClaimLock.findUnique.mockResolvedValue({
        userId: 'u1',
        lockedUntil: new Date(Date.now() + 6 * 3_600_000),
      });
      mockPrisma.userCard.findFirst.mockResolvedValue({
        obtainedAt: new Date(),
      });

      const result = await service.status('u1');

      expect(result.canClaim).toBe(false);
      expect(result.nextClaimAt).not.toBeNull();
      expect(result.claimWarning).toContain('Girar continua liberado');
      expect(result.bypassPriceCents).toBe(299);
      expect(result.canSpin).toBe(true);
    });

    it('marca pityDue após 30 dias sem Épica+', async () => {
      const old = new Date(Date.now() - 40 * 86_400_000);
      mockPrisma.userCard.findFirst.mockResolvedValue({ obtainedAt: old });

      const result = await service.status('u1');

      expect(result.pityDue).toBe(true);
      expect(result.pityDaysLeft).toBe(0);
    });
  });

  describe('spin', () => {
    function stockOnly(rarity: string, size = 5) {
      mockPrisma.card.count.mockImplementation(
        (args: { where: { rarity: string } }) =>
          Promise.resolve(args.where.rarity === rarity ? size : 0),
      );
    }

    function freshAccount() {
      mockPrisma.userCard.findFirst.mockResolvedValue(null);
    }

    it('cria preview sem ownership (sem editionCounter, sem UserCard)', async () => {
      freshAccount();
      stockOnly('COMUM');
      mockPrisma.card.findFirst.mockResolvedValue(cardComum);
      mockPrisma.gachaSpin.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 's1',
          slot: 0,
          hour: new Date(),
          claimedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          createdAt: new Date(),
          card: cardComum,
          ...args.data,
        }),
      );

      const preview = await service.spin('u1');

      expect(preview.card.id).toBe('w1');
      expect(preview.conditionLabel).toBeDefined();
      expect(mockPrisma.gachaSpin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', slot: 0 }),
        }),
      );
      expect(mockPrisma.card.update).not.toHaveBeenCalled();
      expect(mockPrisma.userCard.create).not.toHaveBeenCalled();
      expect(mockPrisma.post.create).not.toHaveBeenCalled();
    });

    it('barra sexto spin da hora', async () => {
      freshAccount();
      stockOnly('COMUM');
      mockPrisma.card.findFirst.mockResolvedValue(cardComum);
      mockPrisma.gachaSpin.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.spin('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.gachaSpin.create).toHaveBeenCalledTimes(5);
    });

    it('pity força tier Épica+ no preview', async () => {
      const old = new Date(Date.now() - 40 * 86_400_000);
      mockPrisma.userCard.findFirst.mockResolvedValue({ obtainedAt: old });
      stockOnly('LENDARIA');
      mockPrisma.card.findFirst.mockResolvedValue({
        ...cardEpica,
        id: 'w9',
        rarity: 'LENDARIA',
      });
      mockPrisma.gachaSpin.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({
          id: 's2',
          slot: 0,
          hour: new Date(),
          claimedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          createdAt: new Date(),
          card: { ...cardEpica, id: 'w9', rarity: 'LENDARIA' },
          ...args.data,
        }),
      );

      const preview = await service.spin('u1');

      expect(preview.pityDue).toBe(true);
      expect(preview.card.rarity).toBe('LENDARIA');
    });

    it('falha quando pool está vazio', async () => {
      freshAccount();
      mockPrisma.card.count.mockResolvedValue(0);

      await expect(service.spin('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('claim', () => {
    const previewComum = {
      id: 's1',
      slot: 0,
      hour: new Date(),
      condition: 0.05,
      foil: 'NORMAL',
      value: 30,
      claimedAt: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      card: cardComum,
    };

    function mockClaimCreate(pullId = 'p1', rarity: string = 'COMUM') {
      mockPullCreate(pullId, rarity);
    }

    it('resgata preview criando UserCard e lock de 6h', async () => {
      mockPrisma.gachaSpin.findFirst.mockResolvedValue(previewComum);
      mockClaimCreate();

      const pull = await service.claim('u1', 's1');

      expect(pull.card.id).toBe('w1');
      expect(pull.edition).toBe(1);
      expect(pull.conditionLabel).toBeDefined();
      expect(mockPrisma.gachaClaimLock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          create: expect.objectContaining({ userId: 'u1' }),
        }),
      );
      expect(mockPrisma.post.create).not.toHaveBeenCalled();
    });

    it('credita metade do valor da carta em Crystal no claim)', async () => {
      mockPrisma.gachaSpin.findFirst.mockResolvedValue(previewComum);
      mockClaimCreate();

      const pull = await service.claim('u1', 's1');

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { crystalBalance: { increment: Math.floor(pull.value / 2) } },
        }),
      );
      expect(mockPrisma.crystalEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          delta: Math.floor(pull.value / 2),
          type: 'MINT',
          refId: pull.id,
          reason: `Carta guardada: ${pull.card.name}`,
        },
      });
    });

    it('publica Épica+ no feed quando privacidade permite', async () => {
      mockPrisma.gachaSpin.findFirst.mockResolvedValue({
        ...previewComum,
        id: 's2',
        card: cardEpica,
      });
      mockClaimCreate('p2', 'EPICA');
      mockPrisma.privacySettings.findUnique.mockResolvedValue({
        showGacha: true,
      });
      mockPrisma.post.create.mockResolvedValue({ id: 'post1' });

      const pull = await service.claim('u1', 's2');

      expect(pull.card.rarity).toBe('EPICA');
      expect(mockPrisma.post.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', kind: 'GACHA_PULL' }),
        }),
      );
    });

    it('barra claim durante lock de 6h', async () => {
      mockPrisma.gachaSpin.findFirst.mockResolvedValue(previewComum);
      mockPrisma.gachaClaimLock.findUnique.mockResolvedValue({
        userId: 'u1',
        lockedUntil: new Date(Date.now() + 6 * 3_600_000),
      });

      await expect(service.claim('u1', 's1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.userCard.create).not.toHaveBeenCalled();
    });

    it('rejeita preview expirada ou já resgatada', async () => {
      mockPrisma.gachaSpin.findFirst.mockResolvedValue(null);
      await expect(service.claim('u1', 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      mockPrisma.gachaSpin.findFirst.mockResolvedValue({
        ...previewComum,
        claimedAt: new Date(),
      });
      await expect(service.claim('u1', 's1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      mockPrisma.gachaSpin.findFirst.mockResolvedValue({
        ...previewComum,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.claim('u1', 's1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('converte conflito transacional concorrente em erro controlado', async () => {
      mockPrisma.$transaction.mockRejectedValue({
        code: 'P2034',
      });

      await expect(service.claim('u1', 's1')).rejects.toMatchObject({
        response: {
          message: 'Este preview já está sendo resgatado. Tente novamente.',
        },
        status: 403,
      });
    });

    it('unlockClaim libera lock vigente e retorna false sem lock', async () => {
      mockPrisma.gachaClaimLock.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(service.unlockClaim('u1')).resolves.toEqual({
        unlocked: true,
      });
      expect(mockPrisma.gachaClaimLock.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', lockedUntil: { gt: expect.any(Date) } },
      });

      mockPrisma.gachaClaimLock.findUnique.mockResolvedValue(null);
      await expect(service.unlockClaim('u1')).resolves.toEqual({
        unlocked: false,
      });
    });
  });

  describe('claimCompensation', () => {
    it('cunha giro garantido e marca a notificação como resgatada', async () => {
      mockPrisma.card.count.mockResolvedValue(1);
      mockPrisma.card.findFirst.mockResolvedValue(cardEpica);
      mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n1' });
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
      mockPullCreate('c1', 'EPICA');

      const pull = await service.claimCompensation('u1');

      expect(pull.conditionLabel).toBeDefined();
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', claimed: false },
        data: { claimed: true },
      });
      expect(mockPrisma.userCard.create).toHaveBeenCalled();
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { crystalBalance: { increment: Math.floor(pull.value / 2) } },
        }),
      );
    });

    it('rejeita quando não há compensação pendente', async () => {
      mockPrisma.card.count.mockResolvedValue(1);
      mockPrisma.card.findFirst.mockResolvedValue(cardEpica);
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.claimCompensation('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.userCard.create).not.toHaveBeenCalled();
    });

    it('rejeita corrida quando a notificação já virou lida', async () => {
      mockPrisma.card.count.mockResolvedValue(1);
      mockPrisma.card.findFirst.mockResolvedValue(cardEpica);
      mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n1' });
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.claimCompensation('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.userCard.create).not.toHaveBeenCalled();
    });
  });

  describe('roll (desativado)', () => {
    it('rejeita a carta diária sem consumir giro', async () => {
      await expect(service.roll()).rejects.toBeInstanceOf(GoneException);
      expect(mockPrisma.gachaSpin.create).not.toHaveBeenCalled();
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
          where: {
            userId: 'u1',
            status: 'ACTIVE',
            card: { rarity: 'RARA' },
            foil: 'HOLO',
          },
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
          where: { userId: 'u2', status: 'ACTIVE' },
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

      mockPrisma.card.findUnique.mockResolvedValue({
        rarity: 'COMUM',
        animeId: 'a1',
        image: 'https://img.test/card.jpg',
        name: 'Card',
      });
      mockPrisma.card.update.mockResolvedValue({ id: 'c1' });
      await service.adminUpdateCard('c1', { name: 'Novo' });
      expect(mockPrisma.card.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: 'Novo' },
      });

      mockPrisma.card.findUnique.mockResolvedValue({
        rarity: 'EPICA',
        animeId: 'a1',
        image: 'https://img.test/card.jpg',
        name: 'Card',
      });
      mockPrisma.card.update.mockResolvedValue({
        id: 'c1',
        rarity: 'LENDARIA',
      });
      mockPrisma.userCard.findMany.mockResolvedValue([
        {
          id: 'p1',
          condition: 0.05,
          foil: 'NORMAL',
          edition: 1,
          value: 100,
        },
      ]);
      mockPrisma.userCard.update.mockResolvedValue({ id: 'p1' });

      const repriced = await service.adminUpdateCard('c1', {
        rarity: 'LENDARIA',
      });
      expect(repriced).toMatchObject({ repriced: 1 });
      expect(mockPrisma.userCard.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { value: cardValue('LENDARIA', 0.05, 'NORMAL', 1) },
      });
      mockPrisma.card.findUnique.mockResolvedValue(null);
      await expect(
        service.adminUpdateCard('ghost', { rarity: 'RARA' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      await service.adminUserCards('u1', 1, 10);
      expect(mockPrisma.userCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );

      await service.adminResetRoll('u1');
      expect(mockPrisma.gachaRollDay.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', day: expect.any(Date) },
      });
      expect(mockPrisma.gachaSpin.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', hour: expect.any(Date) },
      });
      expect(mockPrisma.gachaClaimLock.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
    });
  });

  describe('encyclopedia', () => {
    const encCard = (
      id: string,
      animeId: string | null,
      animeTitle: string | null = null,
    ) => ({
      id,
      name: id,
      image: `https://img/${id}.jpg`,
      rarity: 'COMUM',
      favourites: 10,
      animeId,
      animeTitle,
      anime:
        animeId && !animeTitle
          ? { id: animeId, slug: `slug-${animeId}`, title: `T-${animeId}` }
          : null,
    });

    const catalog = [
      encCard('c1', 'a1'),
      encCard('c2', 'a1'),
      encCard('c3', null),
      encCard('c4', 'a2', 'Fallback'),
    ];

    beforeEach(() => {
      mockPrisma.card.findMany.mockResolvedValue(catalog);
    });

    it('sem usuário: tudo owned=false, anime sem relação usa animeTitle', async () => {
      const res = await service.encyclopedia(null);

      expect(res.stats).toEqual({
        totalCards: 4,
        ownedCards: 0,
        totalSets: 3,
        completeSets: 0,
      });
      const a2 = res.sets.find((s) => s.animeId === 'a2');
      expect(a2).toMatchObject({ animeTitle: 'Fallback', owned: 0 });
      const semAnime = res.sets.find((s) => s.animeId === null);
      expect(semAnime).toMatchObject({ animeTitle: null, animeSlug: null });
      expect(mockPrisma.userCard.findMany).not.toHaveBeenCalled();
    });

    it('com usuário: marca owned e set incompleto', async () => {
      mockPrisma.userCard.findMany.mockResolvedValue([{ cardId: 'c1' }]);

      const res = await service.encyclopedia('u1');

      const a1 = res.sets.find((s) => s.animeId === 'a1');
      expect(a1).toMatchObject({ owned: 1, total: 2, complete: false });
      expect(res.stats).toMatchObject({ ownedCards: 1, completeSets: 0 });
    });

    it('set completo quando todas as cartas pertencem ao usuário', async () => {
      mockPrisma.userCard.findMany.mockResolvedValue([
        { cardId: 'c1' },
        { cardId: 'c2' },
      ]);

      const res = await service.encyclopedia('u1');

      const a1 = res.sets.find((s) => s.animeId === 'a1');
      expect(a1?.complete).toBe(true);
      expect(res.stats.completeSets).toBe(1);
    });
  });

  describe('trades', () => {
    const pullCard = (id: string) => ({
      id,
      condition: 0.5,
      foil: 'NORMAL',
      edition: 1,
      value: 10,
      obtainedAt: new Date(),
      user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
      card: cardComum,
    });

    function tradeRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 't1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
        completedAt: null,
        offeredUserId: 'u1',
        requestedUserId: 'u2',
        offeredUserCardId: 'oc1',
        requestedUserCardId: 'rc1',
        offeredUserCard: pullCard('oc1'),
        requestedUserCard: pullCard('rc1'),
        ...overrides,
      };
    }

    function mockTradeOwners() {
      mockPrisma.userCard.findUnique.mockImplementation(
        (args: { where: { id: string } }) =>
          Promise.resolve(
            args.where.id === 'oc1'
              ? { id: 'oc1', userId: 'u1' }
              : { id: 'rc1', userId: 'u2' },
          ),
      );
      mockPrisma.userCard.findMany.mockResolvedValue([
        { id: 'oc1', userId: 'u1' },
        { id: 'rc1', userId: 'u2' },
      ]);
    }

    describe('createTrade', () => {
      it('rejeita trocar uma carta com ela mesma', async () => {
        await expect(
          service.createTrade('u1', 'oc1', 'oc1'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockPrisma.userCard.findUnique).not.toHaveBeenCalled();
      });

      it('404 quando carta oferecida não existe', async () => {
        mockPrisma.userCard.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'rc1', userId: 'u2' });

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('404 quando carta pedida não existe', async () => {
        mockPrisma.userCard.findUnique
          .mockResolvedValueOnce({ id: 'oc1', userId: 'u1' })
          .mockResolvedValueOnce(null);

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('403 quando oferecida não é minha', async () => {
        mockPrisma.userCard.findUnique
          .mockResolvedValueOnce({ id: 'oc1', userId: 'u9' })
          .mockResolvedValueOnce({ id: 'rc1', userId: 'u2' });

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('400 quando carta pedida é minha também', async () => {
        mockPrisma.userCard.findUnique
          .mockResolvedValueOnce({ id: 'oc1', userId: 'u1' })
          .mockResolvedValueOnce({ id: 'rc1', userId: 'u1' });

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('403 quando coleção pedida é privada', async () => {
        mockTradeOwners();
        mockPrisma.privacySettings.findUnique.mockResolvedValue({
          showGacha: false,
        });

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('cria proposta com TTL e formata conditionLabel', async () => {
        mockTradeOwners();
        mockPrisma.privacySettings.findUnique.mockResolvedValue(null);
        mockPrisma.gachaTrade.create.mockResolvedValue(tradeRow());

        const res = await service.createTrade('u1', 'oc1', 'rc1');

        expect(mockPrisma.gachaTrade.create).toHaveBeenCalledWith({
          data: {
            offeredUserId: 'u1',
            offeredUserCardId: 'oc1',
            requestedUserId: 'u2',
            requestedUserCardId: 'rc1',
            expiresAt: expect.any(Date),
          },
          select: expect.any(Object),
        });
        expect(res).toMatchObject({
          id: 't1',
          status: 'PENDING',
          offeredUserCard: { conditionLabel: 'PLAYED' },
          requestedUserCard: { conditionLabel: 'PLAYED' },
        });
      });

      it('409 quando uma das cartas já está em troca pendente', async () => {
        mockTradeOwners();
        mockPrisma.gachaTrade.count
          .mockResolvedValueOnce(1)
          .mockResolvedValue(0);

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('409 quando a carta pedida já tem troca pendente', async () => {
        mockTradeOwners();
        mockPrisma.gachaTrade.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(1)
          .mockResolvedValue(0);

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('409 ao estourar limite de propostas enviadas', async () => {
        mockTradeOwners();
        mockPrisma.gachaTrade.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(3)
          .mockResolvedValue(0);

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('409 ao estourar limite de propostas recebidas', async () => {
        mockTradeOwners();
        mockPrisma.gachaTrade.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(3);

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('409 quando unique de carta pendente falha em corrida (P2002)', async () => {
        mockTradeOwners();
        mockPrisma.gachaTrade.create.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '7.0.0',
          }),
        );

        await expect(
          service.createTrade('u1', 'oc1', 'rc1'),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('repropaga erro que não é P2002', async () => {
        mockTradeOwners();
        mockPrisma.gachaTrade.create.mockRejectedValue(new Error('boom'));

        await expect(service.createTrade('u1', 'oc1', 'rc1')).rejects.toThrow(
          'boom',
        );
      });
    });

    it('myTrades lista e formata as duas pontas', async () => {
      mockPrisma.gachaTrade.findMany.mockResolvedValue([
        tradeRow(),
        tradeRow({ id: 't2' }),
      ]);

      const res = await service.myTrades('u1');

      expect(mockPrisma.gachaTrade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ offeredUserId: 'u1' }, { requestedUserId: 'u1' }] },
        }),
      );
      expect(res).toHaveLength(2);
      expect(res[1]?.offeredUserCard.conditionLabel).toBe('PLAYED');
    });

    describe('acceptTrade', () => {
      it('rejeita aceite que perdeu corrida com cancelamento', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());
        mockTradeOwners();
        mockPrisma.gachaTrade.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.acceptTrade('u2', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(mockPrisma.userCard.updateMany).not.toHaveBeenCalled();
      });

      it('rejeita mudança de dono entre leitura e escrita', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());
        mockTradeOwners();
        mockPrisma.userCard.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.acceptTrade('u2', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('troca donos, limpa destaque e conclui', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());
        mockTradeOwners();
        mockPrisma.gachaTrade.update.mockResolvedValue(
          tradeRow({ status: 'COMPLETED' }),
        );

        const res = await service.acceptTrade('u2', 't1');

        expect(mockPrisma.userCard.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['oc1'] }, userId: 'u1' },
          data: { userId: 'u2' },
        });
        expect(mockPrisma.userCard.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['rc1'] }, userId: 'u2' },
          data: { userId: 'u1' },
        });
        expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
          where: { id: 'u1', featuredUserCardId: 'oc1' },
          data: { featuredUserCardId: null },
        });
        expect(res.status).toBe('COMPLETED');
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('404 quando troca não existe', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(null);
        await expect(service.acceptTrade('u2', 't1')).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });

      it('403 quando quem aceita não é o receptor', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());
        await expect(service.acceptTrade('u1', 't1')).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      });

      it('409 quando já expirada antes de aceitar', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(
          tradeRow({ status: 'EXPIRED' }),
        );
        await expect(service.acceptTrade('u2', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('409 quando já concluída antes de aceitar', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(
          tradeRow({ status: 'CANCELLED' }),
        );
        await expect(service.acceptTrade('u2', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('expira no aceite quando TTL venceu no relógio', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(
          tradeRow({ expiresAt: new Date(Date.now() - 1000) }),
        );

        await expect(service.acceptTrade('u2', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(mockPrisma.gachaTrade.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: 'EXPIRED' } }),
        );
      });

      it('409 quando carta mudou de dono', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());
        mockPrisma.userCard.findUnique.mockResolvedValue({
          id: 'oc1',
          userId: 'u99',
        });

        await expect(service.acceptTrade('u2', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
      });
    });

    describe('settleTrade (cancel/decline)', () => {
      it.each(['cancelTrade', 'declineTrade'] as const)(
        '%s não sobrescreve aceite concorrente',
        async (method) => {
          mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());
          mockPrisma.gachaTrade.updateMany.mockResolvedValue({ count: 0 });

          await expect(
            service[method](method === 'cancelTrade' ? 'u1' : 'u2', 't1'),
          ).rejects.toBeInstanceOf(ConflictException);
        },
      );

      it('cancelar troca pendente', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());

        await expect(service.cancelTrade('u1', 't1')).resolves.toEqual({
          id: 't1',
          status: 'CANCELLED',
        });
        expect(mockPrisma.gachaTrade.updateMany).toHaveBeenCalledWith({
          where: { id: 't1', status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
      });

      it('recusar troca pendente', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());

        await expect(service.declineTrade('u2', 't1')).resolves.toEqual({
          id: 't1',
          status: 'CANCELLED',
        });
      });

      it('404 quando troca não existe', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(null);
        await expect(service.cancelTrade('u1', 't1')).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });

      it('403 quando quem cancela não é o ofertante', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());
        await expect(service.cancelTrade('u9', 't1')).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      });

      it('403 quando quem recusa não é o receptor', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(tradeRow());
        await expect(service.declineTrade('u9', 't1')).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      });

      it('409 quando já expirada', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(
          tradeRow({ status: 'EXPIRED' }),
        );
        await expect(service.cancelTrade('u1', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('409 quando não está mais pendente', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(
          tradeRow({ status: 'COMPLETED' }),
        );
        await expect(service.declineTrade('u2', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('expira quando TTL venceu no relógio', async () => {
        mockPrisma.gachaTrade.findUnique.mockResolvedValue(
          tradeRow({ expiresAt: new Date(Date.now() - 1000) }),
        );

        await expect(service.cancelTrade('u1', 't1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(mockPrisma.gachaTrade.updateMany).toHaveBeenCalledWith({
          where: expect.objectContaining({ id: 't1' }),
          data: { status: 'EXPIRED' },
        });
      });
    });
  });

  describe('crystals', () => {
    it('separa pontos da coleção e moeda disponível no status', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        crystalBalance: 50,
        gachaCosmetics: [],
      });
      mockPrisma.userCard.aggregate.mockResolvedValue({ _sum: { value: 101 } });
      const status = await service.status('u1');
      expect(status.pointsBalance).toBe(101);
      expect(status.crystalBalance).toBe(50);
    });

    it('alias points retorna a carteira Crystal e rejeita paginação inválida', async () => {
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        crystalBalance: 45,
      });
      expect((await service.points('u1')).balance).toBe(45);
      await expect(service.crystals('u1', 1.5)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.crystals('u1', Number.MAX_SAFE_INTEGER, 50),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('daily recusado não credita carteira nem extrato', async () => {
      mockPrisma.gachaDailyBonus.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.dailyBonus('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.crystalEvent.create).not.toHaveBeenCalled();
    });

    it('bloqueia reroll de carta anunciada antes de cobrar', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue({ id: 'p1' });
      mockPrisma.gachaListing.findFirst.mockResolvedValue({ id: 'l1' });
      await expect(service.reroll('u1', 'p1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.crystalEvent.create).not.toHaveBeenCalled();
    });

    it('adjustCrystals registra evento ADMIN e atualiza saldo', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ crystalBalance: 100 });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.crystalEvent.create.mockResolvedValue({ id: 'e1' });

      await service.adjustCrystals('u1', 50, 'estorno de bug');

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { crystalBalance: { increment: 50 } },
        }),
      );
      expect(mockPrisma.crystalEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            delta: 50,
            type: 'ADMIN',
            reason: 'estorno de bug',
          }),
        }),
      );
    });

    it('adjustCrystals barra saldo negativo e delta inválido', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ crystalBalance: 10 });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.adjustCrystals('u1', -50, 'punicao'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.adjustCrystals('u1', 0, 'noop'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.adjustCrystals('u1', 5, '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('reroll cobra 10% do value, troca condition/foil e reprecifica', async () => {
      const owned = {
        id: 'p1',
        condition: 0.5,
        foil: 'NORMAL',
        edition: 42,
        value: 100,
        obtainedAt: new Date(),
        user: { id: 'u1', name: 'U', userName: 'u', avatar: null },
        card: { ...cardComum, anime: null },
      };
      owned.card.anime = null;
      mockPrisma.userCard.findFirst.mockResolvedValue(owned);
      mockPrisma.gachaTrade.findFirst.mockResolvedValue(null);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.crystalEvent.create.mockResolvedValue({});
      mockPrisma.userCard.update.mockImplementation(
        (args: {
          data: { condition: number; foil: 'NORMAL' | 'HOLO' | 'GOLD' };
        }) =>
          Promise.resolve({
            ...owned,
            condition: args.data.condition,
            foil: args.data.foil,
            value: cardValue('COMUM', args.data.condition, args.data.foil, 42),
          }),
      );

      const pull = await service.reroll('u1', 'p1');

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', crystalBalance: { gte: 10, lte: 2_147_483_647 } },
        data: { crystalBalance: { increment: -10 } },
      });
      expect(mockPrisma.crystalEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ delta: -10, type: 'SPEND' }),
        }),
      );
      expect(pull.conditionLabel).toBeDefined();
    });

    it('reroll barra carta em troca pendente e saldo insuficiente', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue({
        id: 'p1',
        condition: 0.5,
        foil: 'NORMAL',
        edition: 42,
        value: 100,
        card: cardComum,
      });
      mockPrisma.gachaTrade.findFirst.mockResolvedValue({ id: 't1' });
      await expect(service.reroll('u1', 'p1')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      mockPrisma.gachaTrade.findFirst.mockResolvedValue(null);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reroll('u1', 'p1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.userCard.update).not.toHaveBeenCalled();
    });

    it('queima carta, credita 40% e preserva registro como BURNED', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue({
        id: 'p1',
        value: 100,
        edition: 3,
        card: { name: 'Card Comum' },
      });
      mockPrisma.gachaTrade.findFirst.mockResolvedValue(null);
      mockPrisma.gachaListing.findFirst.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.crystalEvent.create.mockResolvedValue({});

      await expect(service.burn('u1', 'p1')).resolves.toEqual({
        burned: 'p1',
        payout: 40,
      });
      expect(mockPrisma.userCard.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', userId: 'u1', status: 'ACTIVE' },
        data: { status: 'BURNED' },
      });
      expect(mockPrisma.crystalEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            delta: 40,
            type: 'BURN',
            refId: 'p1',
          }),
        }),
      );
    });

    it('bloqueia queima da carta destacada', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue({
        id: 'p1',
        value: 100,
        edition: 3,
        card: { name: 'Card Comum' },
      });
      mockPrisma.gachaTrade.findFirst.mockResolvedValue(null);
      mockPrisma.gachaListing.findFirst.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });

      await expect(service.burn('u1', 'p1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.crystalEvent.create).not.toHaveBeenCalled();
    });

    it('garante payout mínimo de 1 Crystal', async () => {
      mockPrisma.userCard.findFirst.mockResolvedValue({
        id: 'p1',
        value: 1,
        edition: 3,
        card: { name: 'Card Comum' },
      });
      mockPrisma.gachaTrade.findFirst.mockResolvedValue(null);
      mockPrisma.gachaListing.findFirst.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.crystalEvent.create.mockResolvedValue({});

      await service.burn('u1', 'p1');
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { crystalBalance: { increment: 1 } } }),
      );
    });

    it('buyCosmetic barra key inexistente, posse duplicada e saldo baixo', async () => {
      await expect(
        service.buyCosmetic('u1', 'NAO_EXISTE'),
      ).rejects.toBeInstanceOf(BadRequestException);

      mockPrisma.user.findUnique.mockResolvedValue({
        gachaCosmetics: ['FRAME_AURORA'],
      });
      await expect(
        service.buyCosmetic('u1', 'FRAME_AURORA'),
      ).rejects.toBeInstanceOf(BadRequestException);

      mockPrisma.user.findUnique.mockResolvedValue({ gachaCosmetics: [] });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.buyCosmetic('u1', 'FRAME_AURORA'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('market', () => {
    it('buyListing move carta, credita venda e queima taxa de 10%', async () => {
      mockPrisma.gachaListing.findUnique.mockResolvedValue({
        id: 'l1',
        userId: 'u2',
        price: 100,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3_600_000),
        userCardId: 'p1',
        userCard: { id: 'p1', card: { name: 'X' } },
      });
      mockPrisma.gachaListing.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.userCard.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.crystalEvent.create.mockResolvedValue({});

      await expect(service.buyListing('u1', 'l1')).resolves.toEqual({
        purchased: 'l1',
        price: 100,
      });

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1', crystalBalance: { gte: 100, lte: 2_147_483_647 } },
          data: { crystalBalance: { increment: -100 } },
        }),
      );
      expect(mockPrisma.userCard.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1', userId: 'u2' },
          data: { userId: 'u1' },
        }),
      );
      const events = mockPrisma.crystalEvent.create.mock.calls.map(
        (call: [{ data: { delta: number; type: string } }]) => call[0].data,
      );
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: 'u1', delta: -100 }),
          expect.objectContaining({ userId: 'u2', delta: 100, type: 'SALE' }),
          expect.objectContaining({ userId: 'u2', delta: -10, type: 'TAX' }),
        ]),
      );
    });

    it('buyListing barra auto-compra, expirado e corrida', async () => {
      mockPrisma.gachaListing.findUnique.mockResolvedValue({
        id: 'l1',
        userId: 'u1',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3_600_000),
        userCardId: 'p1',
        userCard: { id: 'p1', card: { name: 'X' } },
      });
      await expect(service.buyListing('u1', 'l1')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      mockPrisma.gachaListing.findUnique.mockResolvedValue({
        id: 'l1',
        userId: 'u2',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 1000),
        userCardId: 'p1',
        userCard: { id: 'p1', card: { name: 'X' } },
      });
      mockPrisma.gachaListing.update.mockResolvedValue({});
      await expect(service.buyListing('u1', 'l1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      mockPrisma.gachaListing.findUnique.mockResolvedValue({
        id: 'l1',
        userId: 'u2',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3_600_000),
        userCardId: 'p1',
        userCard: { id: 'p1', card: { name: 'X' } },
      });
      mockPrisma.gachaListing.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.buyListing('u1', 'l1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.userCard.updateMany).not.toHaveBeenCalled();
    });

    it('createListing barra preço inválido, troca pendente, limite e carta duplamente anunciada', async () => {
      await expect(service.createListing('u1', 'p1', 0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.createListing('u1', 'p1', 1.5),
      ).rejects.toBeInstanceOf(BadRequestException);

      mockPrisma.userCard.findFirst.mockResolvedValue({ id: 'p1' });
      mockPrisma.gachaTrade.findFirst.mockResolvedValue({ id: 't1' });
      await expect(
        service.createListing('u1', 'p1', 10),
      ).rejects.toBeInstanceOf(BadRequestException);

      mockPrisma.gachaTrade.findFirst.mockResolvedValue(null);
      mockPrisma.gachaListing.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.gachaListing.count.mockResolvedValue(5);
      await expect(
        service.createListing('u1', 'p1', 10),
      ).rejects.toBeInstanceOf(BadRequestException);

      mockPrisma.gachaListing.count.mockResolvedValue(0);
      mockPrisma.gachaListing.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '7',
        }),
      );
      await expect(
        service.createListing('u1', 'p1', 10),
      ).rejects.toBeInstanceOf(ConflictException);
      // Transaction is still entered for atomicity, but no userCard updates happen.
      expect(mockPrisma.userCard.update).not.toHaveBeenCalled();
    });

    it('lista skins com posse e cooldown', async () => {
      const nextSpinAt = new Date(Date.now() + 60_000);
      mockPrisma.gachaSkin.findMany.mockResolvedValue([
        {
          id: 's1',
          name: 'Asuka',
          imageUrl: 'https://cdn.example/asuka.webp',
          sourceUrl: 'https://myanimelist.net/character/1',
          active: true,
          blocked: false,
          card: { id: 'c1', name: 'Asuka', malCharacterId: 1 },
          owners: [{ acquiredAt: new Date(0) }],
        },
      ]);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        crystalBalance: 2000,
        equippedGachaSkinId: 's1',
        nextGachaSkinSpinAt: nextSpinAt,
      });
      const result = await service.skinCatalog('u1');
      expect(result.canSpin).toBe(false);
      expect(result.skins[0]).toMatchObject({
        id: 's1',
        owned: true,
        equipped: true,
      });
    });

    it('gira skin grátis e registra cooldown', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        crystalBalance: 0,
        nextGachaSkinSpinAt: null,
      });
      mockPrisma.gachaSkin.findMany.mockResolvedValue([
        {
          id: 's1',
          name: 'Asuka',
          imageUrl: 'https://cdn.example/asuka.webp',
          sourceUrl: null,
          card: null,
        },
      ]);
      mockPrisma.userGachaSkin.create.mockResolvedValue({ id: 'us1' });
      mockPrisma.user.update.mockResolvedValue({});
      const result = await service.spinSkin('u1');
      expect(result.price).toBe(0);
      expect(mockPrisma.crystalEvent.create).not.toHaveBeenCalled();
      expect(mockPrisma.userGachaSkin.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          skinId: 's1',
          name: 'Asuka',
          imageUrl: 'https://cdn.example/asuka.webp',
        },
      });
    });

    it('equipa e remove skin somente se pertencer ao usuário', async () => {
      mockPrisma.userGachaSkin.findUnique.mockResolvedValue({
        skin: { blocked: false },
      });
      mockPrisma.user.update.mockResolvedValue({ equippedGachaSkinId: 's1' });
      await expect(service.equipSkin('u1', 's1')).resolves.toEqual({
        equippedSkinId: 's1',
      });
      mockPrisma.user.update.mockResolvedValue({ equippedGachaSkinId: null });
      await expect(service.equipSkin('u1', null)).resolves.toEqual({
        equippedSkinId: null,
      });
    });
  });
});

describe('gacha constants', () => {
  it('precifica carta: base × condition × foil + bônus low edition', () => {
    expect(cardValue('COMUM', 0.05, 'NORMAL', 500)).toBe(30);
    expect(cardValue('LENDARIA', 0.05, 'GOLD', 1)).toBe(12000 + 12000);
    expect(cardValue('RARA', 0.9, 'HOLO', 11)).toBe(180);
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
