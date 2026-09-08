import { ExtractionJobService } from './extraction-job.service';

function flush(ms = 10) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('ExtractionJobService', () => {
  it('cria e recupera job por id', async () => {
    const svc = new ExtractionJobService();
    const job = svc.submit('naruto', 1, 1, async () => ({
      videoUrl: 'https://cdn.example.com/v.mp4',
      playerEmbed: null,
    }));
    expect(job.animeSlug).toBe('naruto');
    expect(['pending', 'processing']).toContain(job.status);
    expect(svc.getJob(job.id)).toBe(job);
    await flush();
    expect(svc.getJob(job.id)?.status).toBe('completed');
    expect(svc.getJob(job.id)?.result).toEqual({
      videoUrl: 'https://cdn.example.com/v.mp4',
      playerEmbed: null,
    });
  });

  it('retorna job existente para mesmo episódio pendente (dedup)', async () => {
    const svc = new ExtractionJobService();
    const fn = jest.fn(async () => ({ videoUrl: null, playerEmbed: 'x' }));
    const blocking = jest.fn(
      () => new Promise<{ videoUrl: null; playerEmbed: string }>(() => {}),
    );
    const first = svc.submit('one-piece', 5, 1, blocking as any);
    const second = svc.submit('one-piece', 5, 1, fn as any);
    expect(second).toBe(first);
    expect(fn).not.toHaveBeenCalled();
    await flush();
  });

  it('findByEpisode ignora jobs finalizados', async () => {
    const svc = new ExtractionJobService();
    svc.submit('bleach', 2, 1, async () => ({
      videoUrl: 'u',
      playerEmbed: null,
    }));
    await flush();
    expect(svc.findByEpisode('bleach', 2, 1)).toBeUndefined();
  });

  it('marca job como failed quando fn rejeita', async () => {
    const svc = new ExtractionJobService();
    const job = svc.submit('bleach', 3, 1, async () => {
      throw new Error('boom');
    });
    await flush();
    const done = svc.getJob(job.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('boom');
  });

  it('onComplete chama imediatamente para job terminal', async () => {
    const svc = new ExtractionJobService();
    const job = svc.submit('naruto', 9, 1, async () => ({
      videoUrl: 'u',
      playerEmbed: null,
    }));
    await flush();
    const listener = jest.fn();
    const cleanup = svc.onComplete(job.id, listener);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: job.id }),
    );
    cleanup();
  });

  it('onComplete notifica na conclusão e cleanup remove listener', async () => {
    const svc = new ExtractionJobService();
    let resolveFn!: (v: {
      videoUrl: string | null;
      playerEmbed: string | null;
    }) => void;
    const gate = new Promise<{
      videoUrl: string | null;
      playerEmbed: string | null;
    }>((r) => {
      resolveFn = r;
    });
    const job = svc.submit('naruto', 10, 1, () => gate);
    const listener = jest.fn();
    const cleanup = svc.onComplete(job.id, listener);
    expect(listener).not.toHaveBeenCalled();
    cleanup();
    resolveFn({ videoUrl: 'u', playerEmbed: null });
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('onComplete entrega resultado quando listener ativo', async () => {
    const svc = new ExtractionJobService();
    let resolveFn!: (v: {
      videoUrl: string | null;
      playerEmbed: string | null;
    }) => void;
    const gate = new Promise<{
      videoUrl: string | null;
      playerEmbed: string | null;
    }>((r) => {
      resolveFn = r;
    });
    const job = svc.submit('naruto', 11, 1, () => gate);
    const listener = jest.fn();
    svc.onComplete(job.id, listener);
    resolveFn({ videoUrl: 'u', playerEmbed: null });
    await flush();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('listener com erro não quebra os demais', async () => {
    const svc = new ExtractionJobService();
    const job = svc.submit('naruto', 12, 1, async () => ({
      videoUrl: 'u',
      playerEmbed: null,
    }));
    const bad = jest.fn(() => {
      throw new Error('listener boom');
    });
    const good = jest.fn();
    svc.onComplete(job.id, bad);
    svc.onComplete(job.id, good);
    await flush();
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it('cleanup remove jobs expirados', async () => {
    const svc = new ExtractionJobService();
    const job = svc.submit('naruto', 13, 1, async () => ({
      videoUrl: 'u',
      playerEmbed: null,
    }));
    await flush();
    const stored = svc.getJob(job.id);
    expect(stored).toBeDefined();
    stored!.completedAt = Date.now() - 10 * 60_000;
    svc.cleanup();
    expect(svc.getJob(job.id)).toBeUndefined();
  });

  it('cleanup mantém jobs recentes', async () => {
    const svc = new ExtractionJobService();
    const job = svc.submit('naruto', 14, 1, async () => ({
      videoUrl: 'u',
      playerEmbed: null,
    }));
    await flush();
    svc.cleanup();
    expect(svc.getJob(job.id)).toBeDefined();
  });

  it('onComplete para job desconhecido registra listener sem chamar', () => {
    const svc = new ExtractionJobService();
    const listener = jest.fn();
    const cleanup = svc.onComplete('job-inexistente', listener);
    expect(listener).not.toHaveBeenCalled();
    cleanup();
  });

  it('cleanup mantém entry quando ainda há listeners', async () => {
    const svc = new ExtractionJobService();
    let resolveFn!: (v: {
      videoUrl: string | null;
      playerEmbed: string | null;
    }) => void;
    const gate = new Promise<{
      videoUrl: string | null;
      playerEmbed: string | null;
    }>((r) => {
      resolveFn = r;
    });
    const job = svc.submit('naruto', 20, 1, () => gate);
    const l1 = jest.fn();
    const l2 = jest.fn();
    const cleanup1 = svc.onComplete(job.id, l1);
    svc.onComplete(job.id, l2);
    cleanup1();
    expect((svc as any).completionListeners.has(job.id)).toBe(true);
    resolveFn({ videoUrl: 'u', playerEmbed: null });
    await flush();
    expect(l2).toHaveBeenCalled();
  });

  it('marca job como failed com erro não-Error', async () => {
    const svc = new ExtractionJobService();
    const job = svc.submit('bleach', 30, 1, async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- cobre branch String(err) para throws não-Error
      throw 'string boom';
    });
    await flush();
    expect(svc.getJob(job.id)?.status).toBe('failed');
    expect(svc.getJob(job.id)?.error).toBe('string boom');
  });

  it('enfileira quando concorrência máxima é atingida e drena após concluir', async () => {
    const svc = new ExtractionJobService();
    (svc as any).activeJobs = 5;
    const queuedFn = jest.fn(async () => ({
      videoUrl: 'q',
      playerEmbed: null,
    }));
    const job = svc.submit('naruto', 99, 1, queuedFn as any);
    expect(queuedFn).not.toHaveBeenCalled();
    expect((svc as any).queue.length).toBe(1);
    (svc as any).activeJobs = 0;
    (svc as any).drainQueue();
    await flush(20);
    expect(queuedFn).toHaveBeenCalled();
    expect(svc.getJob(job.id)?.status).toBe('completed');
  });
});
