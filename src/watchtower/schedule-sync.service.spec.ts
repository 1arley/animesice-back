import { ScheduleSync } from '@/watchtower/schedule-sync.service';

function makeMocks() {
  return {
    prisma: {
      $executeRaw: jest.fn(async () => 1),
      $transaction: jest.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
      anime: {
        findMany: jest.fn(),
        count: jest.fn(async () => 0),
        update: jest.fn(),
      },
      animeSchedule: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async () => ({})),
      },
    },
    anilist: {
      searchMedia: jest.fn(),
      mediaSchedule: jest.fn(),
    },
    jobs: {
      enqueue: jest.fn(async () => undefined),
    },
  };
}

describe('ScheduleSync', () => {
  it('backfillAnilist casa anime por título e grava metadados', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', slug: 'solo-leveling', title: 'Solo Leveling' },
    ]);
    m.anilist.searchMedia.mockResolvedValue({
      id: 12345,
      title: { romaji: 'Solo Leveling', english: null, native: null },
      status: 'RELEASING',
      season: 'WINTER',
      seasonYear: 2024,
      format: 'TV',
      episodes: 12,
      studios: { nodes: [{ name: 'A-1 Pictures', isAnimationStudio: true }] },
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const matched = await svc.backfillAnilist();
    expect(matched).toBe(1);
    expect(m.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(m.prisma.anime.update).not.toHaveBeenCalled();
  });

  it('backfillAnilist ignora match ambíguo (score < 0.6)', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', slug: 'pokemon', title: 'Pokemon' },
    ]);
    m.anilist.searchMedia.mockResolvedValue({
      id: 777,
      title: { romaji: 'Digimon Adventure', english: null, native: null },
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const matched = await svc.backfillAnilist();
    expect(matched).toBe(0);
    expect(m.prisma.anime.update).not.toHaveBeenCalled();
  });

  it('backfillAnilist auto-enfileira continua quando há pendentes', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', slug: 'x', title: 'X' },
    ]);
    m.prisma.anime.count.mockResolvedValue(12);
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    await svc.backfillAnilist();
    expect(m.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BACKFILL_ANILIST' }),
    );
  });

  it('syncSchedules sincroniza status e deriva horário fixo do mediaSchedule', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', anilistId: 12345, status: 'LANCAMENTO' },
    ]);
    // segunda-feira 2024-01-01T18:00:00Z -> America/Sao_Paulo: segunda 15:00
    m.anilist.mediaSchedule.mockResolvedValue({
      status: 'FINISHED',
      startDate: { year: 2024, month: 1, day: 1 },
      endDate: { year: 2024, month: 3, day: 31 },
      schedule: [
        {
          airingAt: Math.floor(Date.UTC(2024, 0, 1, 18, 0)) / 1000,
          episode: 1,
        },
        {
          airingAt: Math.floor(Date.UTC(2024, 0, 8, 18, 0)) / 1000,
          episode: 2,
        },
      ],
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const synced = await svc.syncSchedules();
    expect(synced.synced).toBe(1);
    expect(m.prisma.animeSchedule.deleteMany).toHaveBeenCalledWith({
      where: { animeId: { in: ['anime-1'] } },
    });
    expect(m.prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(m.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(m.prisma.anime.update).not.toHaveBeenCalled();
  });

  it('backfillAnilist retorna 0 quando não há animes pendentes', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([]);
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const matched = await svc.backfillAnilist();
    expect(matched).toBe(0);
    expect(m.anilist.searchMedia).not.toHaveBeenCalled();
    expect(m.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('backfillAnilist pula quando searchMedia retorna null', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', slug: 'test-anime', title: 'Test Anime' },
    ]);
    m.anilist.searchMedia.mockResolvedValue(null);
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const matched = await svc.backfillAnilist();
    expect(matched).toBe(0);
    expect(m.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('backfillAnilist loga erro e continua quando searchMedia lança exceção', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', slug: 'error-anime', title: 'Error Anime' },
    ]);
    m.anilist.searchMedia.mockRejectedValue(new Error('network timeout'));
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const matched = await svc.backfillAnilist();
    expect(matched).toBe(0);
    expect(m.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('syncSchedules atualiza metadata quando status muda no AniList', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', anilistId: 12345, status: 'LANCAMENTO' },
    ]);
    m.anilist.mediaSchedule.mockResolvedValue({
      status: 'FINISHED',
      startDate: { year: 2024, month: 1, day: 1 },
      endDate: { year: 2024, month: 3, day: 31 },
      schedule: [],
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const synced = await svc.syncSchedules();
    expect(synced.synced).toBe(1);
    expect(m.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(m.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('syncSchedules continua quando mediaSchedule lança exceção', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', anilistId: 12345, status: 'LANCAMENTO' },
      { id: 'anime-2', anilistId: 67890, status: 'LANCAMENTO' },
    ]);
    m.anilist.mediaSchedule
      .mockRejectedValueOnce(new Error('rate limit'))
      .mockResolvedValueOnce({
        status: 'RELEASING',
        startDate: null,
        endDate: null,
        schedule: [],
      });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const synced = await svc.syncSchedules();
    expect(synced.synced).toBe(1);
  });

  it('backfillAnilist cobre todos os paths de mapStatus e validSeason/format', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'a1', slug: 's1', title: 'S1' },
      { id: 'a2', slug: 's2', title: 'S2' },
      { id: 'a3', slug: 's3', title: 'S3' },
      { id: 'a4', slug: 's4', title: 'S4' },
      { id: 'a5', slug: 's5', title: 'S5' },
    ]);
    m.prisma.anime.count.mockResolvedValue(0);
    m.anilist.searchMedia
      .mockResolvedValueOnce({
        id: 1,
        title: { romaji: 'S1' },
        status: 'RELEASING',
        season: 'WINTER',
        seasonYear: 2024,
        format: 'TV',
        episodes: 12,
        endDate: null,
        studios: { nodes: [{ name: 'A', isAnimationStudio: true }] },
      })
      .mockResolvedValueOnce({
        id: 2,
        title: { romaji: 'S2' },
        status: 'FINISHED',
        season: 'SPRING',
        seasonYear: 2024,
        format: 'MOVIE',
        episodes: 1,
        endDate: { year: 2024, month: 6, day: 15 },
        studios: { nodes: [] },
      })
      .mockResolvedValueOnce({
        id: 3,
        title: { romaji: 'S3' },
        status: 'CANCELLED',
        season: 'SUMMER',
        seasonYear: 2024,
        format: 'OVA',
        episodes: 6,
        endDate: null,
        studios: { nodes: [{ name: 'B', isAnimationStudio: false }] },
      })
      .mockResolvedValueOnce({
        id: 4,
        title: { romaji: 'S4' },
        status: 'HIATUS',
        season: 'FALL',
        seasonYear: 2024,
        format: 'ONA',
        episodes: null,
        endDate: null,
        studios: { nodes: [{ name: null, isAnimationStudio: true }] },
      })
      .mockResolvedValueOnce({
        id: 5,
        title: { romaji: 'S5' },
        status: 'NOT_YET_RELEASED',
        season: 'WINTER',
        seasonYear: 2025,
        format: 'SPECIAL',
        episodes: 1,
        endDate: null,
        studios: { nodes: [{ name: 'C', isAnimationStudio: true }] },
      });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const matched = await svc.backfillAnilist();
    expect(matched).toBe(5);
    expect(m.prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('backfillAnilist ignora formato e season inválidos', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'a1', slug: 'test', title: 'Test' },
    ]);
    m.prisma.anime.count.mockResolvedValue(0);
    m.anilist.searchMedia.mockResolvedValue({
      id: 99,
      title: { romaji: 'Test' },
      status: 'UNKNOWN_STATUS',
      season: 'INVALID_SEASON',
      seasonYear: 2024,
      format: 'INVALID_FORMAT',
      episodes: null,
      endDate: null,
      studios: { nodes: [] },
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const matched = await svc.backfillAnilist();
    expect(matched).toBe(1);
  });

  it('syncSchedules pula anime sem episódios agendados', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', anilistId: 12345, status: 'LANCAMENTO' },
    ]);
    m.anilist.mediaSchedule.mockResolvedValue({
      status: 'RELEASING',
      startDate: null,
      endDate: null,
      schedule: [],
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const synced = await svc.syncSchedules();
    expect(synced.synced).toBe(1);
    expect(m.prisma.animeSchedule.create).not.toHaveBeenCalled();
    expect(m.prisma.anime.update).not.toHaveBeenCalled();
  });

  it('syncSchedules filtra apenas published + LANCAMENTO + anilistId', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([]);
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    await svc.syncSchedules();
    const call = m.prisma.anime.findMany.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.where).toEqual({
      published: true,
      anilistId: { not: null },
      status: { in: ['LANCAMENTO'] },
    });
    expect(call.orderBy).toEqual({ id: 'asc' });
    expect(call.take).toBeGreaterThan(25);
  });

  it('syncSchedules retorna continued=false + nextAfterId=null quando a página termina o catálogo', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', anilistId: 12345, status: 'LANCAMENTO' },
    ]);
    m.anilist.mediaSchedule.mockResolvedValue({
      status: 'RELEASING',
      startDate: null,
      endDate: null,
      schedule: [],
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const result = await svc.syncSchedules();
    expect(result).toEqual({
      synced: 1,
      continued: false,
      nextAfterId: null,
    });
  });

  it('syncSchedules usa cursor keyset when afterId presente', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-2', anilistId: 12345, status: 'LANCAMENTO' },
    ]);
    m.anilist.mediaSchedule.mockResolvedValue({
      status: 'RELEASING',
      startDate: null,
      endDate: null,
      schedule: [],
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const result = await svc.syncSchedules({ afterId: 'anime-1' });
    const call = m.prisma.anime.findMany.mock.calls[0]?.[0];
    expect(call.where).toMatchObject({ id: { gt: 'anime-1' } });
    expect(result.continued).toBe(false);
  });

  it('syncSchedules retorna continued=true + nextAfterId quando há mais páginas', async () => {
    const m = makeMocks();
    // 26 itens => excede SYNC_PAGE_SIZE (25) e força sentinela
    const rows = Array.from({ length: 26 }, (_, i) => ({
      id: `anime-${String(i).padStart(2, '0')}`,
      anilistId: 1000 + i,
      status: 'LANCAMENTO',
    }));
    m.prisma.anime.findMany.mockResolvedValue(rows);
    m.anilist.mediaSchedule.mockResolvedValue({
      status: 'RELEASING',
      startDate: null,
      endDate: null,
      schedule: [],
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const result = await svc.syncSchedules();
    expect(result.continued).toBe(true);
    expect(result.nextAfterId).toBe('anime-24');
    expect(result.synced).toBe(25);
  });

  it('syncSchedules página com menos de PAGE_SIZE+1 encerra sem continuação', async () => {
    const m = makeMocks();
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `anime-${String(i).padStart(2, '0')}`,
      anilistId: 1000 + i,
      status: 'LANCAMENTO',
    }));
    m.prisma.anime.findMany.mockResolvedValue(rows);
    m.anilist.mediaSchedule.mockResolvedValue({
      status: 'RELEASING',
      startDate: null,
      endDate: null,
      schedule: [],
    });
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const result = await svc.syncSchedules();
    expect(result.continued).toBe(false);
    expect(result.nextAfterId).toBeNull();
  });

  it('syncSchedules página vazia encerra sem continuação', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([]);
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const result = await svc.syncSchedules();
    expect(result).toEqual({
      synced: 0,
      continued: false,
      nextAfterId: null,
    });
    expect(m.anilist.mediaSchedule).not.toHaveBeenCalled();
  });
});
