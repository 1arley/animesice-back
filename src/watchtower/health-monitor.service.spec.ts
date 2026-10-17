import { HealthMonitor } from '@/watchtower/health-monitor.service';
import { OPTIONAL_SOURCE_IDS, SOURCE_IDS } from '@/watchtower/watchtower.types';

/** Mesma regra do rankedSources: opcionais entram conforme o env. */
function enabledOptionalSources(): readonly string[] {
  return OPTIONAL_SOURCE_IDS.filter(
    (id) =>
      id !== 'animesdigital' || process.env.ANIMESDIGITAL_ENABLED === 'true',
  );
}

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
        for (const [k, v] of Object.entries(args.data ?? {})) {
          existing[k] =
            v && typeof v === 'object' && 'increment' in v
              ? (existing[k] ?? 0) + (v as any).increment
              : v;
        }
        store.set(id, existing);
        return existing;
      }),
      findMany: jest.fn(async () => [...store.values()]),
      findUnique: jest.fn(
        async (args: any) => store.get(args?.where?.sourceId) ?? null,
      ),
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
        if (values.includes(true) || existing.consecutiveFailures >= 5)
          existing.disabled = true;
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
    // Probe da home injetado: o default faz fetch de rede.
    health.probeUp = jest.fn(async () => false);
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

  it('403 isolado não desabilita uma fonte', async () => {
    await health.recordFailure('meusanimes', {
      kind: 'AVAILABILITY',
      error: 'https://meusanimes.blog/e/bleach-1/ retornou 403',
    });
    const row = mock.store.get('meusanimes');
    expect(row.failureCount).toBe(1);
    expect(row.consecutiveFailures).toBe(1);
    expect(row.lastFailureAt).toBeInstanceOf(Date);
    expect(row.disabled).toBe(false);
  });

  it('recordFailure desabilita após 5 falhas consecutivas com o site fora do ar', async () => {
    for (let i = 0; i < 5; i++) {
      await health.recordFailure('animesonlinecc');
    }
    const row = mock.store.get('animesonlinecc');
    expect(row.consecutiveFailures).toBe(5);
    expect(row.disabled).toBe(true);
  });

  it('403 em episódio com site no ar NÃO desabilita a fonte', async () => {
    health.probeUp = jest.fn(async () => true);
    for (let i = 0; i < 20; i++) {
      await health.recordFailure('meusanimes', {
        kind: 'AVAILABILITY',
        error: 'https://meusanimes.blog/e/x/ retornou 403',
      });
    }
    const row = mock.store.get('meusanimes');
    expect(row.disabled).toBeFalsy();
    expect(row.consecutiveFailures).toBe(0);
    expect(row.failureCount).toBe(20);
  });

  it('probe da home roda no máximo 1 vez por TTL em rajada de falhas', async () => {
    health.probeUp = jest.fn(async () => true);
    for (let i = 0; i < 10; i++) {
      await health.recordFailure('meusanimes', { kind: 'AVAILABILITY' });
    }
    expect(health.probeUp).toHaveBeenCalledTimes(1);
  });

  it('fonte auto-desativada volta sozinha depois do cooldown', async () => {
    mock.store.set('meusanimes', {
      sourceId: 'meusanimes',
      disabled: true,
      disabledByAdmin: false,
      consecutiveFailures: 5,
      lastFailureAt: new Date(Date.now() - 31 * 60_000),
    });
    expect(await health.isDisabled('meusanimes')).toBe(false);
    expect(mock.store.get('meusanimes').disabled).toBe(false);
    expect(mock.store.get('meusanimes').consecutiveFailures).toBe(0);
  });

  it('fonte desativada continua desligada dentro do cooldown', async () => {
    mock.store.set('meusanimes', {
      sourceId: 'meusanimes',
      disabled: true,
      disabledByAdmin: false,
      lastFailureAt: new Date(Date.now() - 5 * 60_000),
    });
    expect(await health.isDisabled('meusanimes')).toBe(true);
  });

  it('fonte desligada por admin nunca volta sozinha', async () => {
    mock.store.set('topanimes', {
      sourceId: 'topanimes',
      disabled: true,
      disabledByAdmin: true,
      lastFailureAt: new Date(Date.now() - 10 * 60 * 60_000),
    });
    expect(await health.isDisabled('topanimes')).toBe(true);
  });

  it('rankedSources reabilita fonte com cooldown expirado', async () => {
    mock.store.set('meusanimes', {
      sourceId: 'meusanimes',
      successCount: 1,
      failureCount: 0,
      avgLatencyMs: 100,
      disabled: true,
      disabledByAdmin: false,
      lastFailureAt: new Date(Date.now() - 31 * 60_000),
    });
    expect(await health.rankedSources()).toContain('meusanimes');
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
    expect(result).toEqual([...SOURCE_IDS, ...enabledOptionalSources()]);
    expect(result).toContain('meusanimes');
    expect(result).toContain('animesonline');
  });

  it('rankedSources exclui fontes disabled', async () => {
    mock.store.set('animesonline', {
      sourceId: 'animesonline',
      successCount: 1,
      failureCount: 0,
      consecutiveFailures: 0,
      avgLatencyMs: 100,
      disabled: true,
    });
    const result = await health.rankedSources();
    expect(result).not.toContain('animesonline');
    // Uma fonte a menos que o total habilitado (base + opcionais).
    expect(result).toHaveLength(
      [...SOURCE_IDS, ...enabledOptionalSources()].length - 1,
    );
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

  it('isDisabled retorna true quando a fonte está marcada disabled', async () => {
    mock.store.set('animefire', {
      sourceId: 'animefire',
      disabled: true,
    });
    expect(await health.isDisabled('animefire')).toBe(true);
  });

  it('isDisabled retorna false quando ativa ou quando não há registro', async () => {
    mock.store.set('meusanimes', { sourceId: 'meusanimes', disabled: false });
    expect(await health.isDisabled('meusanimes')).toBe(false);
    expect(await health.isDisabled('inexistente')).toBe(false);
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
