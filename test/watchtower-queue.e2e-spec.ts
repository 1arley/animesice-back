import { JobsService } from '@/watchtower/jobs.service';
import { JOB_TYPE } from '@/watchtower/watchtower.types';
import { getPrismaService } from './setup/e2e.setup';

describe('Watchtower queue concurrency (e2e)', () => {
  it('serializes concurrent catalog claims across transactions', async () => {
    const prisma = getPrismaService();
    const jobs = new JobsService(prisma);
    const suffix = crypto.randomUUID();
    const keys = [
      `catalog-concurrency:${suffix}:1`,
      `catalog-concurrency:${suffix}:2`,
    ];

    expect(
      await prisma.watchtowerJob.count({
        where: { type: JOB_TYPE.SCAN_CATALOG, status: 'RUNNING' },
      }),
    ).toBe(0);

    try {
      await Promise.all(
        keys.map((dedupeKey) =>
          jobs.enqueue({
            type: JOB_TYPE.SCAN_CATALOG,
            dedupeKey,
            payload: {},
            priority: 1,
          }),
        ),
      );

      const batches = await Promise.all([
        jobs.claimBatch(1),
        jobs.claimBatch(1),
      ]);
      const claimedScans = batches
        .flat()
        .filter((job) => job.type === JOB_TYPE.SCAN_CATALOG);
      const runningScans = await prisma.watchtowerJob.count({
        where: { type: JOB_TYPE.SCAN_CATALOG, status: 'RUNNING' },
      });

      expect(claimedScans).toHaveLength(1);
      expect(runningScans).toBe(1);
    } finally {
      await prisma.watchtowerJob.deleteMany({
        where: { type: JOB_TYPE.SCAN_CATALOG, dedupeKey: { in: keys } },
      });
    }
  });
});
