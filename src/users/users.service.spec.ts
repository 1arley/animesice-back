import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UsersService } from '@/users/users.service';

function makePrisma() {
  const user = {
    findFirst: jest.fn(async () => null) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    findUniqueOrThrow: jest.fn(async () => ({})) as jest.Mock,
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    update: jest.fn(async () => ({})) as jest.Mock,
  };
  const privacySettings = {
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const comment = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const rating = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const favorite = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const userAnimeList = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const watchHistory = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  const follow = {
    findMany: jest.fn(async () => []) as jest.Mock,
  };
  const report = {
    create: jest.fn(async () => ({})) as jest.Mock,
  };
  const userCard = {
    findMany: jest.fn(async () => []) as jest.Mock,
  };
  const profileBackground = {
    findMany: jest.fn(async () => []) as jest.Mock,
    findFirst: jest.fn(async () => null) as jest.Mock,
  };
  const prisma = {
    user,
    privacySettings,
    comment,
    rating,
    favorite,
    userAnimeList,
    watchHistory,
    follow,
    report,
    userCard,
    profileBackground,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: jest.fn(async () => []) as jest.Mock,
  };
  return prisma;
}

describe('UsersService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new UsersService(prisma as any);
    return { svc, prisma };
  }

  const userId = 'user-1';
  const userRow = { id: userId, name: 'John', userName: 'john' };

  describe('getPublicProfile', () => {
    it('deve retornar perfil público', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUnique.mockResolvedValue({
        ...userRow,
        _count: {
          comments: 1,
          ratings: 2,
          favorites: 3,
          watchHistories: 4,
          followers: 0,
          following: 0,
        },
      });
      const result = await svc.getPublicProfile(userId);
      expect(result).toHaveProperty('name', 'John');
    });

    it('deve lançar NotFoundException se privacidade fechar perfil', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        profilePublic: false,
        showActivity: true,
        showFavorites: true,
        showRatings: true,
      });
      await expect(svc.getPublicProfile(userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException se usuário não existir', async () => {
      const { svc } = build();
      await expect(svc.getPublicProfile('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('searchUsers', () => {
    it('deve buscar usuários com ordenação recommended (padrão)', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: userId }]);
      prisma.user.findMany.mockResolvedValue([
        {
          ...userRow,
          _count: { comments: 0, ratings: 0, favorites: 0, watchHistories: 0 },
        },
      ]);
      prisma.user.count.mockResolvedValue(1);
      const result = await svc.searchUsers(null, undefined, undefined, 1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { followers: { _count: 'desc' } },
            { comments: { _count: 'desc' } },
            { createdAt: 'desc' },
          ],
        }),
      );
    });

    it('deve aplicar filtro de busca com OR', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: userId }]);
      await svc.searchUsers(null, 'John', undefined, 1, 10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: 'John', mode: 'insensitive' } },
              { userName: { contains: 'John', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });

    it('deve marcar isFollowing para usuário logado', async () => {
      const { svc, prisma } = build();
      const currentUserId = 'current';
      const targetId = 'target-1';
      prisma.$queryRaw.mockResolvedValue([{ id: targetId }]);
      prisma.user.findMany.mockResolvedValue([
        {
          id: targetId,
          name: 'T',
          _count: { comments: 0, ratings: 0, favorites: 0, watchHistories: 0 },
        },
      ]);
      prisma.follow.findMany.mockResolvedValue([{ followeeId: targetId }]);
      prisma.user.count.mockResolvedValue(1);
      const result = await svc.searchUsers(
        currentUserId,
        undefined,
        undefined,
        1,
        10,
      );
      expect(result.data[0]).toHaveProperty('isFollowing', true);
    });

    it('deve ordenar por "new"', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: userId }]);
      await svc.searchUsers(null, undefined, 'new', 1, 10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'desc' }] }),
      );
    });

    it('deve ordenar por "active"', async () => {
      const { svc, prisma } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: userId }]);
      await svc.searchUsers(null, undefined, 'active', 1, 10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { comments: { _count: 'desc' } },
            { ratings: { _count: 'desc' } },
            { watchHistories: { _count: 'desc' } },
            { createdAt: 'desc' },
          ],
        }),
      );
    });
  });

  describe('getUserComments', () => {
    it('deve retornar comentários públicos', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.comment.findMany.mockResolvedValue([
        { id: 'c1', content: 'test', anime: { slug: 's', title: 'T' } },
      ]);
      prisma.comment.count.mockResolvedValue(1);
      const result = await svc.getUserComments(userId, 1, 10);
      expect(result.data).toHaveLength(1);
    });

    it('deve retornar vazio se showActivity for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showActivity: false,
        showFavorites: false,
        showRatings: false,
        profilePublic: false,
      });
      const result = await svc.getUserComments(userId, 1, 10);
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('getUserRatings', () => {
    it('deve retornar avaliações públicas', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.rating.findMany.mockResolvedValue([
        { score: 8, anime: { slug: 's', title: 'T' } },
      ]);
      prisma.rating.count.mockResolvedValue(1);
      const result = await svc.getUserRatings(userId, 1, 10);
      expect(result.data).toHaveLength(1);
    });

    it('deve retornar vazio se showRatings for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showRatings: false,
        showActivity: false,
        showFavorites: false,
        profilePublic: false,
      });
      const result = await svc.getUserRatings(userId, 1, 10);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserFavorites', () => {
    it('deve retornar favoritos públicos', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.favorite.findMany.mockResolvedValue([
        { anime: { id: 'a1', slug: 's', title: 'T' } },
      ]);
      prisma.favorite.count.mockResolvedValue(1);
      const result = await svc.getUserFavorites(userId, 1, 10);
      expect(result.data).toHaveLength(1);
    });

    it('deve retornar vazio se showFavorites for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showFavorites: false,
        showActivity: false,
        showRatings: false,
        profilePublic: false,
      });
      const result = await svc.getUserFavorites(userId, 1, 10);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserAnimeList', () => {
    it('deve retornar lista de animes pública', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.userAnimeList.findMany.mockResolvedValue([
        { anime: { id: 'a1', slug: 's', title: 'T' } },
      ]);
      prisma.userAnimeList.count.mockResolvedValue(1);
      const result = await svc.getUserAnimeList(userId, 1, 10, 'WATCHING');
      expect(result.data).toHaveLength(1);
      expect(prisma.userAnimeList.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId, status: 'WATCHING' }),
        }),
      );
    });

    it('deve retornar vazio se showFavorites for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showFavorites: false,
        showActivity: false,
        showRatings: false,
        profilePublic: false,
      });
      const result = await svc.getUserAnimeList(userId, 1, 10);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserActivity', () => {
    it('deve retornar atividade pública cronológica', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.watchHistory.findMany.mockResolvedValue([
        {
          watchedAt: new Date('2024-01-03'),
          episode: {
            number: 1,
            anime: { slug: 's', title: 'T', coverImage: 'img' },
          },
        },
      ]);
      prisma.rating.findMany.mockResolvedValue([]);
      prisma.favorite.findMany.mockResolvedValue([]);
      prisma.comment.findMany.mockResolvedValue([]);
      prisma.watchHistory.count.mockResolvedValue(1);
      prisma.rating.count.mockResolvedValue(0);
      prisma.favorite.count.mockResolvedValue(0);
      prisma.comment.count.mockResolvedValue(0);
      const result = await svc.getUserActivity(userId, 1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('type', 'watch');
      expect(result.meta.total).toBe(1);
    });

    it('deve retornar vazio se showActivity for false', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        showActivity: false,
        showFavorites: false,
        showRatings: false,
        profilePublic: false,
      });
      const result = await svc.getUserActivity(userId, 1, 10);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserStats', () => {
    it('deve retornar estatísticas públicas', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUnique.mockResolvedValue({
        _count: { comments: 1, ratings: 2, favorites: 3, watchHistories: 4 },
      });
      const result = await svc.getUserStats(userId);
      expect(result).toEqual({
        comments: 1,
        ratings: 2,
        favorites: 3,
        watchHistories: 4,
      });
    });

    it('deve lançar NotFoundException se perfil privado', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        profilePublic: false,
        showActivity: false,
        showFavorites: false,
        showRatings: false,
      });
      await expect(svc.getUserStats(userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('reportUser', () => {
    it('deve denunciar outro usuário', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: 'target' });
      prisma.report.create.mockResolvedValue({ id: 'r1' });
      const result = await svc.reportUser(userId, 'target', 'SPAM', 'notes');
      expect(result).toEqual({ id: 'r1' });
      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reporterId: userId,
            targetType: 'USER',
            targetId: 'target',
          }),
        }),
      );
    });

    it('deve lançar BadRequestException ao denunciar a si mesmo', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      await expect(svc.reportUser(userId, userId, 'SPAM')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar NotFoundException se alvo não existir', async () => {
      const { svc } = build();
      await expect(svc.reportUser(userId, 'x', 'SPAM')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('showcase de perfil', () => {
    const ownedCard = (id: string) => ({
      id,
      card: {
        id: `c-${id}`,
        name: `Card ${id}`,
        image: null,
        imageHidden: false,
        rarity: 'EPICA',
        animeId: null,
        animeTitle: null,
        anime: null,
      },
    });

    function showcaseRow(overrides: Record<string, unknown> = {}) {
      return {
        showcaseSections: ['FEATURED', 'FAVORITES', 'COLLECTION', 'MEDALS'],
        favoriteGachaCardIds: [] as string[],
        pinnedCollectionIds: [] as string[],
        featuredUserCard: null,
        favoriteCollection: null,
        gachaCollectionProgress: [] as unknown[],
        ...overrides,
      };
    }

    it('preserva a ordem das seções e devolve o payload de cada uma', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        showcaseRow({ showcaseSections: ['MEDALS', 'FEATURED'] }),
      );

      const result = await svc.getShowcase('john');

      expect(result.sections).toEqual(['MEDALS', 'FEATURED']);
      expect(result.data).toHaveProperty('FEATURED');
      expect(result.data).toHaveProperty('MEDALS');
    });

    it('resolve apelido e uuid com a mesma consulta', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUniqueOrThrow.mockResolvedValue(showcaseRow());

      await svc.getShowcase('john');

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ id: 'john' }, { userName: 'john' }],
          },
        }),
      );
    });

    it('descarta chaves desconhecidas e duplicadas nas seções', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        showcaseRow({
          showcaseSections: ['MEDALS', 'NAO_EXISTE', 'MEDALS', 'FAVORITES'],
        }),
      );

      const result = await svc.getShowcase(userId);

      expect(result.sections).toEqual(['MEDALS', 'FAVORITES']);
    });

    it('calcula o progresso da coleção favorita só com leitura', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        showcaseRow({
          favoriteCollection: {
            id: 'col-1',
            name: 'Set A',
            slug: 'set-a',
            version: 1,
            members: [{ cardId: 'c1' }, { cardId: 'c2' }, { cardId: 'c3' }],
          },
        }),
      );
      // Sem cartas favoritas a consulta delas nem dispara: a única chamada
      // de userCard.findMany é a de posse.
      prisma.userCard.findMany.mockResolvedValueOnce([
        { cardId: 'c1' },
        { cardId: 'c3' },
      ]);

      const result = await svc.getShowcase(userId);

      expect(result.data.COLLECTION).toEqual(
        expect.objectContaining({ total: 3, discovered: 2, percent: 66 }),
      );
      // Nenhum write: o GET público não pode creditar crystals de marco
      // nem gravar linhas de progresso como collectionProgress() faz.
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('mantém a ordem de pinnedCollectionIds nas medalhas e corta em 3', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        showcaseRow({
          pinnedCollectionIds: ['c3', 'c1', 'c2', 'c4'],
          gachaCollectionProgress: [
            { collectionId: 'c1', version: 1, collection: { name: 'Um' } },
            { collectionId: 'c2', version: 1, collection: { name: 'Dois' } },
            { collectionId: 'c3', version: 2, collection: { name: 'Tres' } },
            { collectionId: 'c4', version: 1, collection: { name: 'Quatro' } },
          ],
        }),
      );

      const result = await svc.getShowcase(userId);

      expect(result.data.MEDALS).toEqual([
        { id: 'c3', name: 'Tres', version: 2 },
        { id: 'c1', name: 'Um', version: 1 },
        { id: 'c2', name: 'Dois', version: 1 },
      ]);
    });

    it('esconde nome e arte de carta oculta', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        showcaseRow({
          featuredUserCard: {
            id: 'uc-1',
            card: {
              id: 'c9',
              name: 'Secreto',
              image: 'https://cdn/x.png',
              imageHidden: true,
              rarity: 'LENDARIA',
            },
          },
        }),
      );

      const result = await svc.getShowcase(userId);

      expect(result.data.FEATURED).toEqual(
        expect.objectContaining({
          card: expect.objectContaining({ name: '???', image: null }),
        }),
      );
    });

    it('omite cartas favoritas que saíram da coleção', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        showcaseRow({ favoriteGachaCardIds: ['uc-1', 'uc-queimada'] }),
      );
      prisma.userCard.findMany.mockResolvedValueOnce([ownedCard('uc-1')]);

      const result = await svc.getShowcase(userId);

      expect(result.data.FAVORITES).toHaveLength(1);
    });

    it('404 quando showGacha está desligado', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        profilePublic: true,
        showGacha: false,
      });

      await expect(svc.getShowcase(userId)).rejects.toThrow(NotFoundException);
    });

    it('404 quando o perfil é privado', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.privacySettings.findUnique.mockResolvedValue({
        profilePublic: false,
        showGacha: true,
      });

      await expect(svc.getShowcase(userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('recortes, seções e fundo', () => {
    it('salva o recorte enviado', async () => {
      const { svc, prisma } = build();
      prisma.user.update.mockResolvedValue({
        avatarCrop: { x: 10, y: 20, scale: 1.5 },
        profileCoverCrop: null,
      });

      const result = await svc.updateCrops(userId, {
        avatarCrop: { x: 10, y: 20, scale: 1.5 },
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { avatarCrop: { x: 10, y: 20, scale: 1.5 } },
        }),
      );
      expect(result.avatarCrop).toEqual({ x: 10, y: 20, scale: 1.5 });
      expect(result.profileCoverCrop).toBeNull();
    });

    it('grava JsonNull quando o recorte volta ao padrão', async () => {
      const { svc, prisma } = build();
      prisma.user.update.mockResolvedValue({
        avatarCrop: null,
        profileCoverCrop: null,
      });

      await svc.updateCrops(userId, { avatarCrop: null });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { avatarCrop: expect.anything() },
        }),
      );
    });

    it('rejeita atualização vazia', async () => {
      const { svc } = build();
      await expect(svc.updateCrops(userId, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('grava as seções na ordem enviada', async () => {
      const { svc, prisma } = build();
      prisma.user.update.mockResolvedValue({});

      const result = await svc.updateShowcaseSections(userId, [
        'MEDALS',
        'FAVORITES',
      ]);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { showcaseSections: ['MEDALS', 'FAVORITES'] },
        }),
      );
      expect(result.sections).toEqual(['MEDALS', 'FAVORITES']);
    });

    it('troca o fundo por um preset habilitado', async () => {
      const { svc, prisma } = build();
      prisma.profileBackground.findFirst.mockResolvedValue({
        id: 'pb-1',
        key: 'aurora',
        name: 'Aurora',
        imageUrl: 'https://cdn/a.jpg',
      });
      prisma.user.update.mockResolvedValue({
        profileBackground: {
          key: 'aurora',
          name: 'Aurora',
          imageUrl: 'https://cdn/a.jpg',
        },
      });

      const result = await svc.setProfileBackground(userId, 'aurora');

      expect(result.profileBackground).toEqual(
        expect.objectContaining({ key: 'aurora' }),
      );
    });

    it('rejeita preset inexistente ou desabilitado', async () => {
      const { svc, prisma } = build();
      prisma.profileBackground.findFirst.mockResolvedValue(null);

      await expect(
        svc.setProfileBackground(userId, 'nao-existe'),
      ).rejects.toThrow(BadRequestException);
    });

    it('limpa o fundo com key nulo sem tocar no preset', async () => {
      const { svc, prisma } = build();
      prisma.user.update.mockResolvedValue({ profileBackground: null });

      const result = await svc.setProfileBackground(userId, null);

      expect(prisma.profileBackground.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { profileBackgroundId: null } }),
      );
      expect(result.profileBackground).toBeNull();
    });

    it('lista só os presets habilitados', async () => {
      const { svc, prisma } = build();
      prisma.profileBackground.findMany.mockResolvedValue([]);

      await svc.listProfileBackgrounds();

      expect(prisma.profileBackground.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enabled: true } }),
      );
    });
  });
});
