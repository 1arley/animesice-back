import { ConflictException, NotFoundException } from '@nestjs/common';
import { AudioType } from '@prisma/client';
import { AdminService } from '@/admin/admin.service';
import { AniListMedia } from '@/admin/anilist.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;
  let anilistService: any;
  let notificationService: any;

  const anime = { id: 'a1', slug: 'naruto', title: 'Naruto' };

  beforeEach(() => {
    prisma = {
      anime: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      episode: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      genre: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    anilistService = { fetchMedia: jest.fn(), searchMedia: jest.fn() };
    notificationService = {
      notifyNewEpisode: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminService(prisma, anilistService, notificationService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createAnime', () => {
    it('cria anime com sucesso e conecta os gêneros', async () => {
      prisma.anime.findUnique.mockResolvedValue(null);
      prisma.anime.create.mockResolvedValue({ id: 'a1', slug: 'naruto' });

      const result = await service.createAnime({
        slug: 'naruto',
        title: 'Naruto',
        genreSlugs: ['acao'],
      });

      expect(result).toEqual({ id: 'a1', slug: 'naruto' });
      const data = prisma.anime.create.mock.calls[0][0].data;
      expect(data.genres).toEqual({ connect: [{ slug: 'acao' }] });
      expect(data.audio).toBe(AudioType.LEGENDADO);
    });

    it('define áudio DUBLADO quando o título contém "dublado"', async () => {
      prisma.anime.findUnique.mockResolvedValue(null);
      prisma.anime.create.mockResolvedValue({});

      await service.createAnime({
        slug: 'naruto-dublado',
        title: 'Naruto Dublado',
      });

      expect(prisma.anime.create.mock.calls[0][0].data.audio).toBe(
        AudioType.DUBLADO,
      );
    });

    it('lança ConflictException quando o slug já existe', async () => {
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1', slug: 'naruto' });

      await expect(
        service.createAnime({ slug: 'naruto', title: 'Naruto' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateAnime', () => {
    it('atualiza anime com sucesso e recalcula o áudio', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.anime.update.mockResolvedValue({
        id: 'a1',
        title: 'Naruto Dublado',
      });

      const result = await service.updateAnime('naruto', {
        title: 'Naruto Dublado',
      });

      expect(result.title).toBe('Naruto Dublado');
      expect(prisma.anime.update.mock.calls[0][0].data.audio).toBe(
        AudioType.DUBLADO,
      );
    });

    it('substitui os gêneros quando genreSlugs é informado', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.anime.update.mockResolvedValue({});

      await service.updateAnime('naruto', { genreSlugs: ['acao'] });

      expect(prisma.anime.update.mock.calls[0][0].data.genres).toEqual({
        set: [{ slug: 'acao' }],
      });
    });

    it('não altera genres quando genreSlugs não é informado', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.anime.update.mockResolvedValue({});

      await service.updateAnime('naruto', { title: 'Naruto Shippuden' });

      expect(prisma.anime.update.mock.calls[0][0].data.genres).toBeUndefined();
    });

    it('lança NotFoundException quando o anime não existe', async () => {
      prisma.anime.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAnime('inexistente', {} as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteAnime', () => {
    it('remove anime com sucesso', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.anime.delete.mockResolvedValue({});

      const result = await service.deleteAnime('naruto');

      expect(result).toEqual({ message: 'Anime removido.' });
      expect(prisma.anime.delete).toHaveBeenCalledWith({
        where: { slug: 'naruto' },
      });
    });

    it('lança NotFoundException quando o anime não existe', async () => {
      prisma.anime.findUnique.mockResolvedValue(null);

      await expect(service.deleteAnime('inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createEpisode', () => {
    it('cria episódio e notifica os assinantes', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.episode.create.mockResolvedValue({
        id: 'e1',
        number: 1,
        animeId: 'a1',
      });

      const result = await service.createEpisode('naruto', {
        number: 1,
      });

      expect(result).toEqual({ id: 'e1', number: 1, animeId: 'a1' });
      expect(prisma.episode.create).toHaveBeenCalledWith({
        data: { number: 1, animeId: 'a1' },
      });
      expect(notificationService.notifyNewEpisode).toHaveBeenCalledWith(
        'a1',
        'Naruto',
        1,
        'naruto',
      );
    });

    it('lança NotFoundException quando o anime não existe', async () => {
      prisma.anime.findUnique.mockResolvedValue(null);

      await expect(
        service.createEpisode('inexistente', { number: 1 } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateEpisode', () => {
    it('atualiza episódio com sucesso', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.episode.findUnique.mockResolvedValue({ id: 'e1', number: 2 });
      prisma.episode.update.mockResolvedValue({
        id: 'e1',
        videoUrl: 'https://cdn/x.mp4',
      });

      const result = await service.updateEpisode('naruto', 2, {
        videoUrl: 'https://cdn/x.mp4',
      });

      expect(result.videoUrl).toBe('https://cdn/x.mp4');
      expect(prisma.episode.findUnique).toHaveBeenCalledWith({
        where: {
          animeId_season_number: { animeId: 'a1', season: 1, number: 2 },
        },
      });
    });

    it('suporta temporada customizada', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.episode.findUnique.mockResolvedValue({ id: 'e1', number: 1 });
      prisma.episode.update.mockResolvedValue({});

      await service.updateEpisode('naruto', 1, {}, 2);

      expect(prisma.episode.findUnique).toHaveBeenCalledWith({
        where: {
          animeId_season_number: { animeId: 'a1', season: 2, number: 1 },
        },
      });
    });

    it('lança NotFoundException quando o anime não existe', async () => {
      prisma.anime.findUnique.mockResolvedValue(null);

      await expect(
        service.updateEpisode('inexistente', 1, {} as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lança NotFoundException quando o episódio não existe', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.episode.findUnique.mockResolvedValue(null);

      await expect(
        service.updateEpisode('naruto', 99, {} as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteEpisode', () => {
    it('remove episódio com sucesso', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.episode.findUnique.mockResolvedValue({ id: 'e1', number: 3 });
      prisma.episode.delete.mockResolvedValue({});

      const result = await service.deleteEpisode('naruto', 3);

      expect(result).toEqual({ message: 'Episódio removido.' });
      expect(prisma.episode.delete).toHaveBeenCalledWith({
        where: { id: 'e1' },
      });
    });

    it('lança NotFoundException quando o anime não existe', async () => {
      prisma.anime.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteEpisode('inexistente', 1),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lança NotFoundException quando o episódio não existe', async () => {
      prisma.anime.findUnique.mockResolvedValue(anime);
      prisma.episode.findUnique.mockResolvedValue(null);

      await expect(service.deleteEpisode('naruto', 99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createGenre', () => {
    it('cria gênero com sucesso', async () => {
      prisma.genre.findUnique.mockResolvedValue(null);
      prisma.genre.create.mockResolvedValue({ slug: 'acao', name: 'Ação' });

      const result = await service.createGenre({
        slug: 'acao',
        name: 'Ação',
      });

      expect(result).toEqual({ slug: 'acao', name: 'Ação' });
      expect(prisma.genre.create).toHaveBeenCalledWith({
        data: { slug: 'acao', name: 'Ação' },
      });
    });

    it('lança ConflictException quando o gênero já existe', async () => {
      prisma.genre.findUnique.mockResolvedValue({ slug: 'acao' });

      await expect(
        service.createGenre({ slug: 'acao', name: 'Ação' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('importFromAniList', () => {
    const media: AniListMedia = {
      id: 123,
      title: {
        romaji: 'Sousou no Frieren',
        english: 'Frieren',
        native: '葬送のフリーレン',
      },
      description: '<script>alert(1)</script><p>Synopsis</p>',
      coverImage: {
        large: 'https://img.example/large.jpg',
        extraLarge: 'https://img.example/xl.jpg',
      },
      bannerImage: 'https://img.example/banner.jpg',
      averageScore: 88,
      status: 'FINISHED',
      genres: ['Action', 'Adventure', null],
      isAdult: false,
      season: 'FALL',
      seasonYear: 2023,
      format: 'TV',
      episodes: 28,
      startDate: { year: 2023, month: 9, day: 29 },
      endDate: { year: 2024, month: 3, day: 22 },
      studios: {
        nodes: [
          { name: 'Madhouse', isAnimationStudio: true },
          { name: 'Publisher', isAnimationStudio: false },
        ],
      },
      source: 'MANGA',
    };

    it('lança NotFoundException quando faltam anilistId e search', async () => {
      await expect(service.importFromAniList({} as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('importa por anilistId com sucesso', async () => {
      anilistService.fetchMedia.mockResolvedValue(media);
      prisma.anime.findUnique.mockResolvedValue(null);
      prisma.genre.upsert.mockResolvedValue({});
      prisma.anime.create.mockResolvedValue({
        id: 'a1',
        slug: 'sousou-no-frieren',
      });

      const result = await service.importFromAniList({
        anilistId: 123,
      });

      expect(anilistService.fetchMedia).toHaveBeenCalledWith(123);
      expect(result.anilistId).toBe(123);
      expect(result.anilistUrl).toBe('https://anilist.co/anime/123');
      const data = prisma.anime.create.mock.calls[0][0].data;
      expect(data.slug).toBe('sousou-no-frieren');
      expect(data.title).toBe('Sousou no Frieren');
      expect(data.synopsis).toBe('p Synopsis /p');
      expect(data.status).toBe('FINALIZADO');
      expect(data.format).toBe('TV');
      expect(data.season).toBe('FALL');
      expect(data.year).toBe(2023);
      expect(data.ageRating).toBe('A14');
      expect(data.episodeCount).toBe(28);
      expect(data.studios).toEqual(['Madhouse']);
      expect(data.genres).toEqual({
        connect: [{ slug: 'action' }, { slug: 'adventure' }],
      });
      expect(data.alternativeTitles).toEqual(['Frieren', '葬送のフリーレン']);
      expect(data.japaneseTitle).toBe('葬送のフリーレン');
      expect(data.source).toBe('MANGA');
      expect(data.published).toBe(true);
      expect(data.audio).toBe(AudioType.LEGENDADO);
      expect(data.releaseDate).toBe(new Date(2023, 8, 29).toISOString());
      expect(data.endDate).toBe(new Date(2024, 2, 22).toISOString());
    });

    it('importa por busca (searchMedia) quando não há anilistId', async () => {
      anilistService.searchMedia.mockResolvedValue(media);
      prisma.anime.findUnique.mockResolvedValue(null);
      prisma.genre.upsert.mockResolvedValue({});
      prisma.anime.create.mockResolvedValue({ id: 'a1' });

      await service.importFromAniList({ search: 'frieren' });

      expect(anilistService.searchMedia).toHaveBeenCalledWith('frieren');
    });

    it('gera slug único com sufixo quando o slug base já existe', async () => {
      anilistService.fetchMedia.mockResolvedValue(media);
      prisma.anime.findUnique
        .mockResolvedValueOnce({ id: 'x' })
        .mockResolvedValueOnce(null)
        .mockResolvedValue(null);
      prisma.genre.upsert.mockResolvedValue({});
      prisma.anime.create.mockResolvedValue({ id: 'a1' });

      await service.importFromAniList({ anilistId: 123 });

      expect(prisma.anime.create.mock.calls[0][0].data.slug).toBe(
        'sousou-no-frieren-2',
      );
    });

    it('não cria gêneros quando a mídia não tem genres', async () => {
      anilistService.fetchMedia.mockResolvedValue({
        ...media,
        genres: null,
        status: null,
        season: null,
        format: null,
        startDate: null,
        endDate: null,
      });
      prisma.anime.findUnique.mockResolvedValue(null);
      prisma.anime.create.mockResolvedValue({ id: 'a1' });

      await service.importFromAniList({ anilistId: 123 });

      expect(prisma.genre.upsert).not.toHaveBeenCalled();
      const data = prisma.anime.create.mock.calls[0][0].data;
      expect(data.genres).toBeUndefined();
      expect(data.status).toBe('LANCAMENTO');
      expect(data.format).toBeUndefined();
      expect(data.season).toBeUndefined();
      expect(data.releaseDate).toBeUndefined();
      expect(data.endDate).toBeUndefined();
    });

    it('lança NotFoundException quando a mídia não tem título', async () => {
      anilistService.fetchMedia.mockResolvedValue({
        id: 1,
        title: { romaji: null, english: null, native: null },
      });
      prisma.anime.findUnique.mockResolvedValue(null);

      await expect(
        service.importFromAniList({ anilistId: 1 } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('marca conteúdo adulto como A18', async () => {
      anilistService.fetchMedia.mockResolvedValue({
        ...media,
        title: { romaji: 'Heavy Series', english: null, native: null },
        isAdult: true,
      });
      prisma.anime.findUnique.mockResolvedValue(null);
      prisma.genre.upsert.mockResolvedValue({});
      prisma.anime.create.mockResolvedValue({ id: 'a1' });

      await service.importFromAniList({ anilistId: 123 });

      expect(prisma.anime.create.mock.calls[0][0].data.ageRating).toBe('A18');
    });
  });

  describe('listAnimesForAdmin', () => {
    it('lista animes com paginação e busca', async () => {
      const animes = [{ id: 'a1', title: 'Naruto' }];
      prisma.$transaction.mockResolvedValue([animes, 1]);

      const result = await service.listAnimesForAdmin(2, 20, 'naruto');

      expect(result.data).toEqual(animes);
      expect(result.meta).toEqual({
        total: 1,
        page: 2,
        limit: 20,
        totalPages: 1,
      });
      expect(prisma.anime.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
          where: {
            OR: [
              { title: { contains: 'naruto', mode: 'insensitive' } },
              { japaneseTitle: { contains: 'naruto', mode: 'insensitive' } },
              { slug: { contains: 'naruto', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('lista sem busca usando paginação padrão', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      const result = await service.listAnimesForAdmin();

      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      });
      expect(prisma.anime.findMany.mock.calls[0][0].where).toEqual({});
    });
  });
});
