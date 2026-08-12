import { HealthMonitor } from '@/watchtower/health-monitor.service';
import { SOURCE_IDS } from '@/watchtower/watchtower.types';

function makeMockPrisma() {
  const store = new Map<string, any>();
  return {
    store,
    watchtowerSourceHealth: {
      upsert: jest.fn(async (args: any) => {
        const id = args.where?.sourceId;
        const existing = store.get(id);
        const row = {
          sourceId: id,
          successCount:
            existing?.successCount ?? args.create?.successCount ?? 0,
          failureCount:
            existing?.failureCount ?? args.create?.failureCount ?? 0,
          consecutiveFailures: existing?.consecutiveFailures ?? 0,
          avgLatencyMs: existing?.avgLatencyMs ?? 0,
          disabled: existing?.disabled ?? false,
          lastSuccessAt: existing?.lastSuccessAt ?? null,
          lastFailureAt: existing?.lastFailureAt ?? null,
          ...args.update,
          ...args.create,
        };
        store.set(id, row);
        return row;
      }),
      update: jest.fn(async (args: any) => {
        const id = args.where?.sourceId;
        const existing = store.get(id) ?? {};
        Object.assign(existing, args.data);
        store.set(id, existing);
        return existing;
      }),
      findMany: jest.fn(async () => [...store.values()]),
      findFirst: jest.fn(async (args: any) => {
        const want =
          args.where?.disabled?.equals ?? args.where?.disabled ?? false;
        return [...store.values()].find((r) => r.disabled === want) ?? null;
      }),
    },
    // Simula a semântica dos UPDATEs atômicos em SQL bruto.
    $executeRaw: jest.fn(async (...args: any[]) => {
      const [strings, ...values] = args;
      const sql = strings.join('?');
      const sourceId = String(values[values.length - 1]);
      const existing = store.get(sourceId) ?? {
        sourceId,
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
        avgLatencyMs: 0,
        disabled: false,
        lastSuccessAt: null,
        lastFailureAt: null,
      };
      if (sql.includes('"successCount"')) {
        const latency = Number(values[0]);
        existing.successCount += 1;
        existing.consecutiveFailures = 0;
        existing.avgLatencyMs =
          existing.successCount === 1
            ? latency
            : Math.round(
                (existing.avgLatencyMs * (existing.successCount - 1) +
                  latency) /
                  existing.successCount,
              );
        existing.lastSuccessAt = new Date();
        existing.disabled = false;
      } else {
        existing.failureCount += 1;
        existing.consecutiveFailures += 1;
        existing.lastFailureAt = new Date();
        if (existing.consecutiveFailures >= 5) existing.disabled = true;
      }
      store.set(sourceId, existing);
      return 1;
    }),
  };
}

describe('HealthMonitor', () => {
  let mock: ReturnType<typeof makeMockPrisma>;
  let health: HealthMonitor;

  beforeEach(() => {
    mock = makeMockPrisma();
    health = new HealthMonitor(mock as any);
  });

  it('recordSuccess zera consecutiveFailures e habilita', async () => {
    mock.store.set('meusanimes', {
      sourceId: 'meusanimes',
      successCount: 4,
      failureCount: 3,
      consecutiveFailures: 2,
      avgLatencyMs: 500,
      disabled: false,
    });
    await health.recordSuccess('meusanimes', 300);
    const row = mock.store.get('meusanimes');
    expect(row.consecutiveFailures).toBe(0);
    expect(row.successCount).toBe(5);
    expect(row.avgLatencyMs).toBeGreaterThan(0);
    expect(row.lastSuccessAt).toBeInstanceOf(Date);
    expect(row.disabled).toBe(false);
  });

  it('recordFailure incrementa failureCount', async () => {
    await health.recordFailure('animefire');
    const row = mock.store.get('animefire');
    expect(row.failureCount).toBe(1);
    expect(row.consecutiveFailures).toBe(1);
    expect(row.lastFailureAt).toBeInstanceOf(Date);
  });

  it('recordFailure desabilita após 5 falhas consecutivas', async () => {
    for (let i = 0; i < 5; i++) {
      await health.recordFailure('animesonlinecc');
    }
    const row = mock.store.get('animesonlinecc');
    expect(row.consecutiveFailures).toBe(5);
    expect(row.disabled).toBe(true);
  });

  it('recordSuccess resseta consecutiveFailures apos falha', async () => {
    await health.recordFailure('meusanimes');
    await health.recordFailure('meusanimes');
    await health.recordSuccess('meusanimes', 200);
    const row = mock.store.get('meusanimes');
    expect(row.consecutiveFailures).toBe(0);
  });

  it('rankedSources retorna todas as fontes ativas', async () => {
    const result = await health.rankedSources();
    expect(result).toHaveLength(SOURCE_IDS.length);
    expect(result).toContain('meusanimes');
    expect(result).toContain('animefire');
  });

  it('rankedSources exclui fontes disabled', async () => {
    mock.store.set('animesonlinecc', {
      sourceId: 'animesonlinecc',
      successCount: 1,
      failureCount: 0,
      consecutiveFailures: 0,
      avgLatencyMs: 100,
      disabled: true,
    });
    const result = await health.rankedSources();
    expect(result).not.toContain('animesonlinecc');
    expect(result).toHaveLength(SOURCE_IDS.length - 1);
  });

  it('rankedSources prioriza meusanimes quando scores similares', async () => {
    mock.store.set('meusanimes', {
      sourceId: 'meusanimes',
      successCount: 10,
      failureCount: 1,
      consecutiveFailures: 0,
      avgLatencyMs: 1000,
      disabled: false,
    });
    const result = await health.rankedSources();
    expect(result[0]).toBe('meusanimes');
  });

  it('reviveOne reabilita 1 fonte disabled', async () => {
    mock.store.set('animefire', {
      sourceId: 'animefire',
      successCount: 0,
      failureCount: 5,
      consecutiveFailures: 5,
      disabled: true,
      lastFailureAt: new Date(),
    });
    const revived = await health.reviveOne();
    expect(revived).toBe('animefire');
    expect(mock.store.get('animefire').disabled).toBe(false);
    expect(mock.store.get('animefire').consecutiveFailures).toBe(0);
  });

  it('reviveOne retorna null quando não há fontes disabled', async () => {
    const result = await health.reviveOne();
    expect(result).toBeNull();
  });
});
