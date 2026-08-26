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
    expect(synced).toBe(1);
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
    expect(synced).toBe(1);
    expect(m.prisma.animeSchedule.create).not.toHaveBeenCalled();
    expect(m.prisma.anime.update).not.toHaveBeenCalled();
  });
});
