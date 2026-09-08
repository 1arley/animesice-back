import { BrowserPool } from './browser-pool.service';
import { chromium } from 'playwright';

jest.mock('playwright', () => ({
  chromium: { launch: jest.fn() },
}));

const mockedLaunch = chromium.launch as jest.Mock;

function makeBrowser(overrides: Record<string, any> = {}) {
  return {
    isConnected: jest.fn(() => true),
    close: jest.fn(async () => undefined),
    newContext: jest.fn(async () => makeContext()),
    ...overrides,
  };
}

function makeContext(overrides: Record<string, any> = {}) {
  return {
    close: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('BrowserPool', () => {
  beforeEach(() => {
    mockedLaunch.mockReset();
  });

  function build() {
    const pool = new BrowserPool();
    return { pool };
  }

  it('inicia o browser no primeiro acquire e retorna release', async () => {
    const browser = makeBrowser();
    mockedLaunch.mockResolvedValue(browser);
    const { pool } = build();

    const acquired = await pool.acquireContext('test');
    expect(mockedLaunch).toHaveBeenCalled();
    expect(browser.newContext).toHaveBeenCalled();
    expect(acquired.browser).toBe(browser);
    await acquired.release();
    await acquired.release();
    expect(pool.getStats().activeContexts).toBe(0);
    await pool.onModuleDestroy();
  });

  it('reusa browser conectado sem relançar', async () => {
    const browser = makeBrowser();
    mockedLaunch.mockResolvedValue(browser);
    const { pool } = build();

    await pool.acquireContext('a');
    mockedLaunch.mockClear();
    await pool.acquireContext('b');
    expect(mockedLaunch).not.toHaveBeenCalled();
    await pool.onModuleDestroy();
  });

  it('getStats reflete contextos ativos e ociosos', async () => {
    const browser = makeBrowser();
    mockedLaunch.mockResolvedValue(browser);
    const { pool } = build();
    expect(pool.getStats()).toEqual({
      browserAlive: false,
      idleContexts: 0,
      activeContexts: 0,
    });
    const acquired = await pool.acquireContext('x');
    expect(pool.getStats().activeContexts).toBe(1);
    await acquired.release();
    expect(pool.getStats().activeContexts).toBe(0);
    await pool.onModuleDestroy();
  });

  it('onModuleInit agenda cleanup e onModuleDestroy fecha tudo', async () => {
    const browser = makeBrowser();
    mockedLaunch.mockResolvedValue(browser);
    const { pool } = build();
    pool.onModuleInit();
    await pool.acquireContext('x');
    await pool.onModuleDestroy();
    expect(browser.close).toHaveBeenCalled();
  });

  it('restart respeita limite de tentativas', async () => {
    const browser = makeBrowser();
    mockedLaunch.mockResolvedValue(browser);
    const { pool } = build();
    await pool.acquireContext('x');
    expect(await pool.restart()).toBe(true);
    (pool as any).restartAttempts = 5;
    expect(await pool.restart()).toBe(false);
    await pool.onModuleDestroy();
  }, 15000);

  it('restart retorna false quando ensureBrowser falha', async () => {
    const { pool } = build();
    mockedLaunch.mockRejectedValue(new Error('launch fail'));
    const ok = await pool.restart();
    expect(ok).toBe(false);
    await pool.onModuleDestroy();
  }, 15000);

  it('fecha browser antigo quando desconectado', async () => {
    const oldBrowser = makeBrowser();
    const newBrowser = makeBrowser();
    mockedLaunch
      .mockResolvedValueOnce(oldBrowser)
      .mockResolvedValue(newBrowser);
    const { pool } = build();
    await pool.acquireContext('a');
    oldBrowser.isConnected.mockReturnValue(false);
    await pool.acquireContext('b');
    expect(oldBrowser.close).toHaveBeenCalled();
    expect(mockedLaunch).toHaveBeenCalledTimes(2);
    await pool.onModuleDestroy();
  });

  it('cleanupIdle remove contextos ociosos expirados', async () => {
    const browser = makeBrowser();
    mockedLaunch.mockResolvedValue(browser);
    const { pool } = build();
    await pool.acquireContext('a');
    const idleContext = makeContext();
    (pool as any).contexts.set('idle-old', {
      context: idleContext,
      lastUsedAt: Date.now() - 60_000,
      inUse: false,
    });
    (pool as any).contexts.set('idle-fresh', {
      context: makeContext(),
      lastUsedAt: Date.now(),
      inUse: false,
    });
    await (pool as any).cleanupIdle();
    expect((pool as any).contexts.has('idle-old')).toBe(false);
    expect((pool as any).contexts.has('idle-fresh')).toBe(true);
    expect(pool.getStats().idleContexts).toBe(1);
    await pool.onModuleDestroy();
  });
});
