jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  default: { existsSync: jest.fn() },
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
  let mockedExistsSync: jest.Mock;

  beforeEach(() => {
    delete process.env.DISPLAY;
    jest.resetModules();
    jest.useFakeTimers();
    const childProcess = require('child_process');
    mockedSpawn = childProcess.spawn;
    mockedSpawn.mockReset();
    const fs = require('fs');
    mockedExistsSync = fs.existsSync;
    mockedExistsSync.mockReset();
    // Padrão: nenhum display vivo (socket ausente) → força criar/recriar.
    mockedExistsSync.mockReturnValue(false);
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

  it('retorna DISPLAY quando já está setado e X server vivo', async () => {
    process.env.DISPLAY = ':0';
    mockedExistsSync.mockReturnValue(true);
    const result = await ensureXvfb();
    expect(result).toBe(':0');
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('descarta DISPLAY órfão (X morto) e relança Xvfb', async () => {
    // socket ausente simulando Xvfb do entrypoint que morreu
    mockedExistsSync.mockReturnValue(false);
    process.env.DISPLAY = ':99';
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

  it('retorna display cacheado quando já iniciado e vivo', async () => {
    const proc = fakeProc();
    mockedSpawn.mockReturnValue(proc);
    const p1 = ensureXvfb();
    jest.advanceTimersByTime(500);
    await p1;

    mockedSpawn.mockClear();
    mockedExistsSync.mockReturnValue(true);
    const r2 = await ensureXvfb();
    expect(r2).toBe(':99');
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('relança Xvfb quando display anterior morreu', async () => {
    const proc = fakeProc();
    mockedSpawn.mockReturnValue(proc);
    const p1 = ensureXvfb();
    jest.advanceTimersByTime(500);
    await p1;

    // Xvfb morreu: socket some, DISPLAY continua setado.
    mockedExistsSync.mockReturnValue(false);
    mockedSpawn.mockClear();
    const p2 = ensureXvfb();
    jest.advanceTimersByTime(500);
    const r2 = await p2;
    expect(r2).toBe(':99');
    expect(mockedSpawn).toHaveBeenCalled();
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
