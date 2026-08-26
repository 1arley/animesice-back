import { WatchtowerController } from './watchtower.controller';

function makeMocks() {
  return {
    prisma: {
      anime: { findUnique: jest.fn() },
      watchtowerSourceHealth: { findMany: jest.fn(), upsert: jest.fn() },
      watchtowerJob: { updateMany: jest.fn() },
    },
    jobs: { stats: jest.fn() },
    release: { checkOne: jest.fn(), checkAll: jest.fn() },
    season: { discover: jest.fn() },
    repair: { sweep: jest.fn() },
    catalog: { scanAll: jest.fn() },
    schedule: { backfillAnilist: jest.fn(), syncSchedules: jest.fn() },
  };
}

describe('WatchtowerController', () => {
  let controller: WatchtowerController;
  let m: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    m = makeMocks();
    controller = new WatchtowerController(
      m.prisma as any,
      m.jobs as any,
      m.release as any,
      m.season as any,
      m.repair as any,
      m.catalog as any,
      m.schedule as any,
    );
    jest.clearAllMocks();
  });

  describe('status', () => {
    it('retorna stats das jobs e fontes', async () => {
      m.jobs.stats.mockResolvedValue({ pending: 5 });
      m.prisma.watchtowerSourceHealth.findMany.mockResolvedValue([
        { sourceId: 'animefire', disabled: false },
      ]);

      const result = await controller.status();
      expect(result.jobs).toEqual({ pending: 5 });
      expect(result.sources).toHaveLength(1);
    });
  });

  describe('check', () => {
    it('retorna erro quando anime não encontrado', async () => {
      m.prisma.anime.findUnique.mockResolvedValue(null);
      const result = await controller.check('not-found');
      expect(result).toEqual({ error: 'Anime não encontrado' });
    });

    it('chama release.checkOne quando anime existe', async () => {
      m.prisma.anime.findUnique.mockResolvedValue({ id: 'a1', title: 'Test' });
      m.release.checkOne.mockResolvedValue(3);
      const result = await controller.check('test');
      expect(result).toEqual({ anime: 'Test', enqueued: 3 });
    });
  });

  describe('retry', () => {
    it('retorna ok true quando job é reenfileirado', async () => {
      m.prisma.watchtowerJob.updateMany.mockResolvedValue({ count: 1 });
      const result = await controller.retry('job-1');
      expect(result).toEqual({ ok: true });
    });

    it('retorna ok false quando job não encontrado', async () => {
      m.prisma.watchtowerJob.updateMany.mockResolvedValue({ count: 0 });
      const result = await controller.retry('job-x');
      expect(result).toEqual({ ok: false });
    });

    it('retorna ok false quando updateMany falha', async () => {
      m.prisma.watchtowerJob.updateMany.mockRejectedValue(
        new Error('db error'),
      );
      const result = await controller.retry('job-err');
      expect(result).toEqual({ ok: false });
    });
  });

  describe('toggle', () => {
    it('faz upsert na source health', async () => {
      m.prisma.watchtowerSourceHealth.upsert.mockResolvedValue({});
      const result = await controller.toggle('src-1', { disabled: true });
      expect(result).toEqual({ sourceId: 'src-1', disabled: true });
    });
  });

  describe('discover', () => {
    it('chama season.discover e retorna count', async () => {
      m.season.discover.mockResolvedValue(5);
      const result = await controller.discover();
      expect(result).toEqual({ created: 5 });
    });
  });

  describe('repairSweep', () => {
    it('chama repair.sweep e retorna count', async () => {
      m.repair.sweep.mockResolvedValue(3);
      const result = await controller.repairSweep();
      expect(result).toEqual({ enqueued: 3 });
    });
  });

  describe('scanAll', () => {
    it('chama catalog.scanAll com force=false por padrão', async () => {
      m.catalog.scanAll.mockResolvedValue({ scanned: 10, enqueued: 8 });
      const result = await controller.scanAll();
      expect(result).toEqual({ scanned: 10, enqueued: 8 });
      expect(m.catalog.scanAll).toHaveBeenCalledWith(false);
    });

    it('chama catalog.scanAll com force=true quando body.force=true', async () => {
      m.catalog.scanAll.mockResolvedValue({ scanned: 5, enqueued: 5 });
      await controller.scanAll({ force: true });
      expect(m.catalog.scanAll).toHaveBeenCalledWith(true);
    });
  });

  describe('backfillAnilist', () => {
    it('chama schedule.backfillAnilist', async () => {
      m.schedule.backfillAnilist.mockResolvedValue(15);
      const result = await controller.backfillAnilist();
      expect(result).toEqual({ matched: 15 });
    });
  });

  describe('syncSchedules', () => {
    it('chama schedule.syncSchedules', async () => {
      m.schedule.syncSchedules.mockResolvedValue(7);
      const result = await controller.syncSchedules();
      expect(result).toEqual({ synced: 7 });
    });
  });
});
