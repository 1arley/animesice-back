import { WatchtowerScheduler } from '@/watchtower/watchtower.scheduler';

function makeMocks() {
  return {
    prisma: {
      $queryRaw: jest.fn(async () => []),
      anime: {
        findMany: jest.fn(async () => []),
      },
    },
    jobs: {
      claimBatch: jest.fn(async () => []),
      reapStale: jest.fn(async () => 0),
      enqueue: jest.fn(async () => undefined),
    },
    worker: {
      process: jest.fn(async () => undefined),
    },
    repair: {
      sweep: jest.fn(async () => 0),
    },
    health: {
      reviveOne: jest.fn(async () => null),
    },
    catalog: {
      scanAll: jest.fn(async () => ({ scanned: 0, enqueued: 0 })),
    },
  };
}

describe('WatchtowerScheduler', () => {
  let m: ReturnType<typeof makeMocks>;
  let scheduler: WatchtowerScheduler;
  const origEnabled = process.env.WATCHTOWER_ENABLED;
  const origRepair = process.env.WT_REPAIR_ENABLED;
  const origDiscover = process.env.WT_SEASON_DISCOVERY_ENABLED;
  const origBackfill = process.env.WT_BACKFILL_ENABLED;
  const origScheduleSync = process.env.WT_SCHEDULE_SYNC_ENABLED;

  beforeEach(() => {
    m = makeMocks();
    scheduler = new WatchtowerScheduler(
      m.prisma as any,
      m.jobs as any,
      m.worker as any,
      m.repair as any,
      m.health as any,
      m.catalog as any,
    );
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (origEnabled === undefined) delete process.env.WATCHTOWER_ENABLED;
    else process.env.WATCHTOWER_ENABLED = origEnabled;

    if (origRepair === undefined) delete process.env.WT_REPAIR_ENABLED;
    else process.env.WT_REPAIR_ENABLED = origRepair;

    if (origDiscover === undefined)
      delete process.env.WT_SEASON_DISCOVERY_ENABLED;
    else process.env.WT_SEASON_DISCOVERY_ENABLED = origDiscover;

    if (origBackfill === undefined) delete process.env.WT_BACKFILL_ENABLED;
    else process.env.WT_BACKFILL_ENABLED = origBackfill;

    if (origScheduleSync === undefined)
      delete process.env.WT_SCHEDULE_SYNC_ENABLED;
    else process.env.WT_SCHEDULE_SYNC_ENABLED = origScheduleSync;
  });

  it('tick não processa quando WATCHTOWER_ENABLED != true', async () => {
    process.env.WATCHTOWER_ENABLED = 'false';
    await scheduler.tick();
    expect(m.jobs.claimBatch).not.toHaveBeenCalled();
  });

  it('tick processa batch quando enabled', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    const fakeJobs = [
      { id: 'j1', type: 'EXTRACT_EPISODE', payload: {}, status: 'RUNNING' },
      { id: 'j2', type: 'CHECK_RELEASES', payload: {}, status: 'RUNNING' },
    ];
    m.jobs.claimBatch.mockResolvedValueOnce(fakeJobs as any);
    await scheduler.tick();
    expect(m.jobs.claimBatch).toHaveBeenCalledTimes(1);
    expect(m.worker.process).toHaveBeenCalledTimes(2);
  });

  it('tick não overlap quando running=true', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    (scheduler as any).running = true;
    await scheduler.tick();
    expect(m.jobs.claimBatch).not.toHaveBeenCalled();
  });

  it('scheduleReleases enfileira CHECK_RELEASES quando enabled', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    await scheduler.scheduleReleases();
    expect(m.jobs.reapStale).toHaveBeenCalledTimes(1);
    expect(m.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CHECK_RELEASES',
        dedupeKey: 'check-releases',
      }),
    );
  });

  it('scheduleReleases não faz nada quando disabled', async () => {
    process.env.WATCHTOWER_ENABLED = 'false';
    await scheduler.scheduleReleases();
    expect(m.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('dailyTasks roda repair + discover + revive quando habilitado', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    process.env.WT_REPAIR_ENABLED = 'true';
    process.env.WT_SEASON_DISCOVERY_ENABLED = 'true';
    await scheduler.dailyTasks();
    expect(m.health.reviveOne).toHaveBeenCalledTimes(1);
    expect(m.repair.sweep).toHaveBeenCalledTimes(1);
    expect(m.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DISCOVER_SEASON' }),
    );
  });

  it('dailyTasks pula repair quando WT_REPAIR_ENABLED=false', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    process.env.WT_REPAIR_ENABLED = 'false';
    await scheduler.dailyTasks();
    expect(m.repair.sweep).not.toHaveBeenCalled();
  });

  it('dailyTasks pula discover quando WT_SEASON_DISCOVERY_ENABLED=false', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    process.env.WT_SEASON_DISCOVERY_ENABLED = 'false';
    await scheduler.dailyTasks();
    expect(m.jobs.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DISCOVER_SEASON' }),
    );
  });

  it('dailyTasks enfileira backfill + sync de horários só com flags opt-in=true', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    process.env.WT_BACKFILL_ENABLED = 'true';
    process.env.WT_SCHEDULE_SYNC_ENABLED = 'true';
    await scheduler.dailyTasks();
    expect(m.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BACKFILL_ANILIST' }),
    );
    expect(m.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SYNC_SCHEDULES' }),
    );
  });

  it('dailyTasks NÃO enfileira backfill/sync sem flags (opt-in — nunca roda sozinho)', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    await scheduler.dailyTasks();
    expect(m.jobs.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BACKFILL_ANILIST' }),
    );
    expect(m.jobs.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SYNC_SCHEDULES' }),
    );
  });

  it('dailyTasks pula backfill quando WT_BACKFILL_ENABLED=false', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    process.env.WT_BACKFILL_ENABLED = 'false';
    await scheduler.dailyTasks();
    expect(m.jobs.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BACKFILL_ANILIST' }),
    );
  });

  it('dailyTasks pula sync de horários quando WT_SCHEDULE_SYNC_ENABLED=false', async () => {
    process.env.WATCHTOWER_ENABLED = 'true';
    process.env.WT_SCHEDULE_SYNC_ENABLED = 'false';
    await scheduler.dailyTasks();
    expect(m.jobs.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SYNC_SCHEDULES' }),
    );
  });
});
