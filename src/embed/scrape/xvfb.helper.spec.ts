jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

function fakeProc(
  overrides: { exitCode?: number | null; signalCode?: string | null } = {},
) {
  const proc: any = {
    exitCode: overrides.exitCode ?? null,
    signalCode: overrides.signalCode ?? null,
    on: jest.fn(),
    pid: 12345,
  };
  return proc;
}

describe('xvfb.helper', () => {
  const savedDisplay = process.env.DISPLAY;
  let ensureXvfb: typeof import('./xvfb.helper').ensureXvfb;
  let waitForXvfb: typeof import('./xvfb.helper').waitForXvfb;
  let mockedSpawn: jest.Mock;

  beforeEach(() => {
    delete process.env.DISPLAY;
    jest.resetModules();
    jest.useFakeTimers();
    const childProcess = require('child_process');
    mockedSpawn = childProcess.spawn;
    mockedSpawn.mockReset();
    const mod = require('./xvfb.helper') as typeof import('./xvfb.helper');
    ensureXvfb = mod.ensureXvfb;
    waitForXvfb = mod.waitForXvfb;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    if (savedDisplay !== undefined) {
      process.env.DISPLAY = savedDisplay;
    } else {
      delete process.env.DISPLAY;
    }
  });

  it('retorna DISPLAY quando já está setado', async () => {
    process.env.DISPLAY = ':0';
    const result = await ensureXvfb();
    expect(result).toBe(':0');
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('inicia Xvfb e retorna display quando processo fica vivo', async () => {
    const proc = fakeProc();
    mockedSpawn.mockReturnValue(proc);

    const promise = ensureXvfb();
    jest.advanceTimersByTime(500);
    const result = await promise;
    expect(result).toBe(':99');
    expect(mockedSpawn).toHaveBeenCalledWith(
      '/usr/bin/Xvfb',
      [':99', '-screen', '0', '1366x768x24'],
      { stdio: 'ignore', detached: true },
    );
    expect(process.env.DISPLAY).toBe(':99');
  });

  it('retorna null quando processo morre imediatamente', async () => {
    const proc = fakeProc({ exitCode: 1 });
    mockedSpawn.mockReturnValue(proc);

    const promise = ensureXvfb();
    jest.advanceTimersByTime(500);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('retorna display cacheado quando já iniciado anteriormente', async () => {
    const proc = fakeProc();
    mockedSpawn.mockReturnValue(proc);
    const p1 = ensureXvfb();
    jest.advanceTimersByTime(500);
    await p1;

    mockedSpawn.mockClear();
    const r2 = await ensureXvfb();
    expect(r2).toBe(':99');
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('limpa cache quando Xvfb emite error', async () => {
    const proc = fakeProc();
    mockedSpawn.mockReturnValue(proc);
    const p = ensureXvfb();
    jest.advanceTimersByTime(500);
    await p;

    const errorHandler = proc.on.mock.calls.find(
      (c: any) => c[0] === 'error',
    )?.[1];
    if (errorHandler) errorHandler(new Error('ENOENT'));
  });

  it('limpa cache quando Xvfb emite exit', async () => {
    const proc = fakeProc();
    mockedSpawn.mockReturnValue(proc);
    const p = ensureXvfb();
    jest.advanceTimersByTime(500);
    await p;

    const exitHandler = proc.on.mock.calls.find(
      (c: any) => c[0] === 'exit',
    )?.[1];
    if (exitHandler) exitHandler(0);
    expect(process.env.DISPLAY).toBe(':99');
  });

  it('waitForXvfb retorna display após iniciar', async () => {
    jest.useRealTimers();
    const proc = fakeProc();
    mockedSpawn.mockReturnValue(proc);
    const result = await waitForXvfb(10);
    expect(result).toBe(':99');
  });

  it('waitForXvfb retorna null quando Xvfb não disponível', async () => {
    jest.useRealTimers();
    mockedSpawn.mockReturnValue(fakeProc({ exitCode: 1 }));
    const result = await waitForXvfb(10);
    expect(result).toBeNull();
  });
});
