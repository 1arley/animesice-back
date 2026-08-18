import { NotFoundException } from '@nestjs/common';
import { AnimeService } from '@/anime/anime.service';
import { DEFAULT_PAGE_SIZE } from '@/common/constants';

function makePrisma() {
  // Mocks tipados como jest.Mock (não como fn de aridade 0): o tsconfig é
  // strict + noUncheckedIndexedAccess, então acessos a mock.calls[0][0]
  // precisam de um calls tipado como any[][].
  const anime = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
    findFirst: jest.fn(async () => null) as jest.Mock,
  };
  const episode = {
    findMany: jest.fn(async () => []) as jest.Mock,
  };
  const favorite = { count: jest.fn(async () => 0) as jest.Mock };
  const rating = {
    aggregate: jest.fn(async () => ({
      _avg: { score: 5 },
      _min: { score: 1 },
      _max: { score: 10 },
    })) as jest.Mock,
    count: jest.fn(async () => 1) as jest.Mock,
  };
  const prisma = {
    anime,
    episode,
    favorite,
    rating,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: jest.fn(async () => []) as jest.Mock,
  };
  return prisma;
}

describe('AnimeService (busca/filtros/paginação)', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new AnimeService(prisma as any);
    return { svc, prisma };
  }

  it('busca monta OR em title/japaneseTitle/slug com insensitive', async () => {
    const { svc, prisma } = build();
    await svc.findAll({ search: 'kaguya' });
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { title: { contains: 'kaguya', mode: 'insensitive' } },
      { japaneseTitle: { contains: 'kaguya', mode: 'insensitive' } },
      { slug: { contains: 'kaguya', mode: 'insensitive' } },
    ]);
  });

  it('genres vira some slug in', async () => {
    const { svc, prisma } = build();
    await svc.findAll({ genres: 'acao, comedia' });
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.genres).toEqual({
      some: { slug: { in: ['acao', 'comedia'] } },
    });
  });

  it('mapeia filtros escalares (status/audio/format/year/season/ageRating)', async () => {
    const { svc, prisma } = build();
    await svc.findAll({
      status: 'ONGOING',
      audio: 'DUBLADO',
      format: 'TV',
      year: '2024',
      season: 'WINTER',
      ageRating: 'PG-13',
    });
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('ONGOING');
    expect(arg.where.audio).toBe('DUBLADO');
    expect(arg.where.format).toBe('TV');
    expect(arg.where.year).toBe(2024);
    expect(arg.where.season).toBe('WINTER');
    expect(arg.where.ageRating).toBe('PG-13');
  });

  it('minScore/maxScore viram rating gte/lte', async () => {
    const { svc, prisma } = build();
    await svc.findAll({ minScore: '7.5', maxScore: '9.0' });
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.rating).toEqual({ gte: 7.5, lte: 9.0 });
  });

  it('published padrão true e "false" desliga o filtro', async () => {
    const { svc, prisma } = build();
    await svc.findAll({});
    expect(prisma.anime.findMany.mock.calls[0][0].where.published).toBe(true);
    await svc.findAll({ published: 'false' });
    expect(prisma.anime.findMany.mock.calls[1][0].where.published).toBe(false);
  });

  it.each([
    ['rating', { rating: 'desc' }],
    ['recentlyAdded', { createdAt: 'desc' }],
    ['views', { episodes: { _count: 'desc' } }],
    ['year', { year: 'desc' }],
    ['title', { title: 'asc' }],
  ])('mapeia sort "%s"', async (sort, expected) => {
    const { svc, prisma } = build();
    await svc.findAll({ sort: sort });
    expect(prisma.anime.findMany.mock.calls[0][0].orderBy).toEqual(expected);
  });

  it('sem sort usa rating desc (padrão)', async () => {
    const { svc, prisma } = build();
    await svc.findAll({});
    expect(prisma.anime.findMany.mock.calls[0][0].orderBy).toEqual({
      rating: 'desc',
    });
  });

  it('pagina com skip/take e aplica caps (0 e >MAX)', async () => {
    const { svc, prisma } = build();
    await svc.findAll({ page: '2', limit: '5' });
    expect(prisma.anime.findMany.mock.calls[0][0].skip).toBe(5);
    expect(prisma.anime.findMany.mock.calls[0][0].take).toBe(5);

    await svc.findAll({ page: '0', limit: '9999' });
    expect(prisma.anime.findMany.mock.calls[1][0].skip).toBe(0);
    expect(prisma.anime.findMany.mock.calls[1][0].take).toBe(100);
  });

  it('retorna meta de paginação com totalPages', async () => {
    const { svc, prisma } = build();
    prisma.anime.count.mockResolvedValue(23);
    const res = await svc.findAll({});
    expect(res.meta).toEqual({
      total: 23,
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      totalPages: 3,
    });
  });

  it('findBySlug inclui genres/episodes (asc)/schedules e filtra published', async () => {
    const { svc, prisma } = build();
    prisma.anime.findFirst.mockResolvedValue({
      id: 'a1',
      genres: [],
      episodes: [],
      animeSchedules: [],
    });
    await svc.findBySlug('x');
    const arg = prisma.anime.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ slug: 'x', published: true });
    expect(arg.include.episodes.orderBy).toEqual({ number: 'asc' });
  });

  it('findBySlug lança 404 quando o anime não existe', async () => {
    const { svc } = build();
    await expect(svc.findBySlug('nao-existe')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('findBySlug lança 404 quando o anime não está publicado', async () => {
    const { svc, prisma } = build();
    prisma.anime.findFirst.mockResolvedValue(null);
    await expect(svc.findBySlug('rascunho')).rejects.toThrow(NotFoundException);
  });

  it('findEpisodesBySlug ordena desc, filtra published e lança 404', async () => {
    const { svc, prisma } = build();
    prisma.anime.findFirst.mockResolvedValue({ id: 'a1', episodes: [] });
    await svc.findEpisodesBySlug('x');
    const arg = prisma.anime.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ slug: 'x', published: true });
    expect(arg.include.episodes.orderBy).toEqual({ number: 'desc' });

    prisma.anime.findFirst.mockResolvedValue(null);
    await expect(svc.findEpisodesBySlug('x')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('findRelated devolve [] quando o anime não tem gêneros', async () => {
    const { svc, prisma } = build();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1', genres: [] });
    expect(await svc.findRelated('x')).toEqual([]);
  });

  it('findRelated busca por gêneros excluindo o próprio, com take cap', async () => {
    const { svc, prisma } = build();
    prisma.anime.findUnique.mockResolvedValue({
      id: 'a1',
      genres: [{ id: 'g1' }, { id: 'g2' }],
    });
    await svc.findRelated('x', 999);
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.id.not).toBe('a1');
    expect(arg.where.published).toBe(true);
    expect(arg.where.genres).toEqual({
      some: { id: { in: ['g1', 'g2'] } },
    });
    expect(arg.take).toBe(12);
    expect(arg.orderBy).toEqual({ rating: 'desc' });
  });

  it('findStats agrega favoritos e ratings', async () => {
    const { svc, prisma } = build();
    prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
    const stats = await svc.findStats('x');
    expect(stats).toEqual({
      favorites: 0,
      ratingAverage: 5,
      ratingCount: 1,
      ratingMin: 1,
      ratingMax: 10,
    });
  });

  it('findRandom devolve null sem animes publicados', async () => {
    const { svc, prisma } = build();
    prisma.anime.count.mockResolvedValue(0);
    expect(await svc.findRandom()).toBeNull();
  });

  it('findRandom busca um publicado aleatório', async () => {
    const { svc, prisma } = build();
    prisma.anime.count.mockResolvedValue(5);
    prisma.anime.findMany.mockResolvedValue([{ id: 'a1', genres: [] }]);
    const res = await svc.findRandom();
    expect(res).not.toBeNull();
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.published).toBe(true);
    expect(arg.take).toBe(1);
  });

  it('findTop ordena por rating desc com cap 100', async () => {
    const { svc, prisma } = build();
    await svc.findTop(500);
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ rating: 'desc' });
    expect(arg.take).toBe(100);
  });

  it('findTrending soma views da janela e preserva a ordem do ranking', async () => {
    const { svc, prisma } = build();
    prisma.episode.findMany.mockResolvedValue([
      { animeId: 'b', views: 3 },
      { animeId: 'a', views: 10 },
      { animeId: 'a', views: 5 },
    ]);
    prisma.anime.findMany.mockResolvedValue([
      { id: 'a', genres: [] },
      { id: 'b', genres: [] },
    ]);
    const res = await svc.findTrending(10, 7);
    expect(res.map((a: { id: string }) => a.id)).toEqual(['a', 'b']);
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.id.in).toEqual(['a', 'b']);
    expect(arg.where.published).toBe(true);
  });

  it('findTrending cai no findTop quando não há views na janela', async () => {
    const { svc, prisma } = build();
    prisma.episode.findMany.mockResolvedValue([]);
    await svc.findTrending(10, 7);
    expect(prisma.anime.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { rating: 'desc' } }),
    );
  });

  it('busca fuzzy: ranking por similaridade substitui o OR e reordena por relevância', async () => {
    const { svc, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([{ id: 'a2' }, { id: 'a1' }]);
    prisma.anime.findMany.mockResolvedValue([
      { id: 'a1', genres: [] },
      { id: 'a2', genres: [] },
    ]);
    const res = await svc.findAll({ search: 'kaguy' });
    expect(res.data.map((a: { id: string }) => a.id)).toEqual(['a2', 'a1']);
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.id).toEqual({ in: ['a2', 'a1'] });
    expect(arg.where.OR).toBeUndefined();
  });

  it('busca fuzzy com sort explícito honra o sort (sem reordenar)', async () => {
    const { svc, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([{ id: 'a2' }, { id: 'a1' }]);
    prisma.anime.findMany.mockResolvedValue([
      { id: 'a1', genres: [] },
      { id: 'a2', genres: [] },
    ]);
    const res = await svc.findAll({ search: 'kaguy', sort: 'rating' });
    expect(res.data.map((a: { id: string }) => a.id)).toEqual(['a1', 'a2']);
    expect(prisma.anime.findMany.mock.calls[0][0].orderBy).toEqual({
      rating: 'desc',
    });
  });

  it('fuzzy sem candidatos acima do limiar cai no contains (OR presente)', async () => {
    const { svc, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([]);
    await svc.findAll({ search: 'kaguya' });
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.id).toBeUndefined();
    expect(arg.where.OR).toBeDefined();
  });

  it('fuzzy indisponível (extensão ausente) degrada p/ contains sem quebrar', async () => {
    const { svc, prisma } = build();
    prisma.$queryRaw.mockRejectedValue(
      new Error('function similarity(text,text) does not exist'),
    );
    const res = await svc.findAll({ search: 'kaguya' });
    expect(res.data).toEqual([]);
    expect(prisma.anime.findMany.mock.calls[0][0].where.OR).toBeDefined();
  });

  it('queries curtas (<3 chars) pulam a fuzzy e usam contains', async () => {
    const { svc, prisma } = build();
    await svc.findAll({ search: 'ka' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('fuzzy compõe com outros filtros (id in + gêneros coexistindo)', async () => {
    const { svc, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    prisma.anime.findMany.mockResolvedValue([
      { id: 'a1', genres: [] },
      { id: 'a2', genres: [] },
    ]);
    await svc.findAll({ search: 'kaguya', genres: 'comedia' });
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.id).toEqual({ in: ['a1', 'a2'] });
    expect(arg.where.genres).toEqual({ some: { slug: { in: ['comedia'] } } });
    expect(arg.where.OR).toBeUndefined();
  });

  it('findCalendar agrupa por dia da semana e separa não-agendados', async () => {
    const { svc, prisma } = build();
    prisma.anime.findMany.mockResolvedValue([
      {
        id: 'a1',
        animeSchedules: [{ dayOfWeek: 1, time: '18:00' }],
        genres: [],
      },
      { id: 'a2', animeSchedules: [], genres: [] },
    ]);
    const res = await svc.findCalendar('WINTER', '2024');
    expect(res.byDay[1]!.animes.map((a: { id: string }) => a.id)).toEqual([
      'a1',
    ]);
    expect(res.unscheduled.map((a: { id: string }) => a.id)).toEqual(['a2']);
    const arg = prisma.anime.findMany.mock.calls[0][0];
    expect(arg.where.season).toBe('WINTER');
    expect(arg.where.year).toBe(2024);
  });
});
