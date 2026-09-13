import { ExtractionJobService } from './extraction-job.service';

function prisma() {
  const rows = new Map<string, any>();
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.OR)
      return where.OR.some((item: any) =>
        matches(row, { ...where, OR: undefined, ...item }),
      );
    return Object.entries(where).every(([key, value]: [string, any]) => {
      if (key === 'OR' || value === undefined) return true;
      if (value?.in) return value.in.includes(row[key]);
      if (value?.lt) return row[key] < value.lt;
      return row[key] === value;
    });
  };
  return {
    streamExtractionJob: {
      create: jest.fn(async ({ data }: any) => {
        if (
          [...rows.values()].some((row) => row.activeKey === data.activeKey)
        ) {
          const error: any = new Error('unique');
          error.code = 'P2002';
          throw error;
        }
        const row = {
          id: crypto.randomUUID(),
          status: 'pending',
          videoUrl: null,
          playerEmbed: null,
          error: null,
          lockedBy: null,
          lockedUntil: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.id) ?? null),
      findFirst: jest.fn(
        async ({ where }: any) =>
          [...rows.values()].find((row) => matches(row, where)) ?? null,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const found = [...rows.values()].filter((row) => matches(row, where));
        found.forEach((row) =>
          Object.assign(row, data, { updatedAt: new Date() }),
        );
        return { count: found.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const found = [...rows.values()].filter((row) => matches(row, where));
        found.forEach((row) => rows.delete(row.id));
        return { count: found.length };
      }),
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('ExtractionJobService', () => {
  it.each(['completed', 'failed'])(
    'notifies listeners on another replica: %s',
    async (status) => {
      jest.useFakeTimers();
      try {
        const db = prisma();
        const first = new ExtractionJobService(db as any);
        const second = new ExtractionJobService(db as any);
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        const job = await first.submit('naruto', 1, 1, async () => {
          await pending;
          if (status === 'failed') throw new Error('extraction failed');
          return { videoUrl: 'ok', playerEmbed: null };
        });
        const listener = jest.fn();
        const unsubscribe = await second.onComplete(job.id, listener);
        release();
        await jest.advanceTimersByTimeAsync(2_000);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ status }),
        );
        unsubscribe();
        await jest.advanceTimersByTimeAsync(2_000);
        expect(listener).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('persiste resultado para outra instância', async () => {
    const db = prisma();
    const first = new ExtractionJobService(db as any);
    const job = await first.submit('naruto', 1, 1, async () => ({
      videoUrl: 'https://cdn.example/v.mp4',
      playerEmbed: null,
    }));
    await flush();
    const second = new ExtractionJobService(db as any);
    await expect(second.getJob(job.id)).resolves.toMatchObject({
      status: 'completed',
      result: { videoUrl: 'https://cdn.example/v.mp4' },
    });
  });

  it('deduplica concorrentes no banco', async () => {
    const db = prisma();
    const service = new ExtractionJobService(db as any);
    let release!: (value: {
      videoUrl: string | null;
      playerEmbed: string | null;
    }) => void;
    const pending = new Promise<{
      videoUrl: string | null;
      playerEmbed: string | null;
    }>((resolve) => {
      release = resolve;
    });
    const first = await service.submit('naruto', 1, 1, () => pending);
    const second = await service.submit('naruto', 1, 1, async () => ({
      videoUrl: 'other',
      playerEmbed: null,
    }));
    expect(second.id).toBe(first.id);
    release({ videoUrl: 'ok', playerEmbed: null });
  });

  it('reclama job abandonado após o lease expirar', async () => {
    const db = prisma();
    const first = new ExtractionJobService(db as any);
    const job = await first.submit('naruto', 1, 1, () => new Promise(() => {}));
    await flush();
    const row = await db.streamExtractionJob.findUnique({
      where: { id: job.id },
    });
    row.lockedUntil = new Date(0);
    const second = new ExtractionJobService(db as any);
    await second.submit('naruto', 1, 1, async () => ({
      videoUrl: 'recovered',
      playerEmbed: null,
    }));
    await flush();
    await expect(second.getJob(job.id)).resolves.toMatchObject({
      status: 'completed',
      result: { videoUrl: 'recovered' },
    });
  });
});
