import { ScheduleSync } from '@/watchtower/schedule-sync.service';

function makeMocks() {
  return {
    prisma: {
      anime: {
        findMany: jest.fn(async () => [
          { id: 'anime-1', slug: 'solo-leveling', title: 'Solo Leveling' },
        ]),
        count: jest.fn(async () => 0),
        update: jest.fn(async () => ({})),
      },
      animeSchedule: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async () => ({})),
      },
    },
    anilist: {
      searchMedia: jest.fn(async () => null),
      airingSchedule: jest.fn(async () => []),
    },
    jobs: {
      enqueue: jest.fn(async () => undefined),
    },
  };
}

describe('ScheduleSync', () => {
  it('backfillAnilist casa anime por título e grava metadados', async () => {
    const m = makeMocks();
    m.anilist.searchMedia.mockResolvedValue({
      id: 12345,
      title: { romaji: 'Solo Leveling', english: null, native: null },
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
    expect(m.prisma.anime.update).toHaveBeenCalledWith({
      where: { id: 'anime-1' },
      data: expect.objectContaining({
        anilistId: 12345,
        year: 2024,
        season: 'WINTER',
        format: 'TV',
        episodeCount: 12,
        studios: ['A-1 Pictures'],
      }),
    });
  });

  it('backfillAnilist ignora match ambíguo (score < 0.6)', async () => {
    const m = makeMocks();
    m.anilist.searchMedia.mockResolvedValue({
      id: 777,
      title: { romaji: 'Pokemon', english: null, native: null },
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

  it('syncSchedules deriva horário fixo do airingSchedule e grava AnimeSchedule', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', anilistId: 12345 },
    ]);
    // segunda-feira 2024-01-01T18:00:00Z -> America/Sao_Paulo: segunda 15:00
    m.anilist.airingSchedule.mockResolvedValue([
      { airingAt: Math.floor(Date.UTC(2024, 0, 1, 18, 0)) / 1000, episode: 1 },
      { airingAt: Math.floor(Date.UTC(2024, 0, 8, 18, 0)) / 1000, episode: 2 },
    ]);
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const synced = await svc.syncSchedules();
    expect(synced).toBe(1);
    expect(m.prisma.animeSchedule.deleteMany).toHaveBeenCalledWith({
      where: { animeId: 'anime-1' },
    });
    const createArg = m.prisma.animeSchedule.create.mock.calls[0][0].data;
    expect(createArg.dayOfWeek).toBe(1); // Segunda
    expect(createArg.time).toBe('15:00');
  });

  it('syncSchedules pula anime sem episódios agendados', async () => {
    const m = makeMocks();
    m.prisma.anime.findMany.mockResolvedValue([
      { id: 'anime-1', anilistId: 12345 },
    ]);
    m.anilist.airingSchedule.mockResolvedValue([]);
    const svc = new ScheduleSync(
      m.prisma as any,
      m.anilist as any,
      m.jobs as any,
    );
    const synced = await svc.syncSchedules();
    expect(synced).toBe(0);
    expect(m.prisma.animeSchedule.create).not.toHaveBeenCalled();
  });
});
