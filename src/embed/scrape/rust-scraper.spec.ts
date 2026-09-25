import { spawn } from 'node:child_process';
import { runRustScraper } from './rust-scraper';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

interface Events {
  error: Array<(err: Error) => void>;
  close: Array<(code?: number) => void>;
}

function makeChild() {
  const events: Events = { error: [], close: [] };
  const stdout: Array<(c: Buffer) => void> = [];
  const stderr: Array<(c: Buffer) => void> = [];
  const child = {
    stdout: {
      on: (_e: string, cb: (c: Buffer) => void) => {
        stdout.push(cb);
      },
    },
    stderr: {
      on: (_e: string, cb: (c: Buffer) => void) => {
        stderr.push(cb);
      },
    },
    on: (e: string, cb: (arg: unknown) => void) => {
      if (e === 'error') events.error.push(cb);
    },
    once: (e: string, cb: (arg: unknown) => void) => {
      if (e === 'error') events.error.push(cb);
      else if (e === 'close') events.close.push(cb);
    },
    kill: jest.fn(),
    stdin: { end: jest.fn() },
  };
  spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return {
    child,
    emitError: (err: Error) => events.error.forEach((cb) => cb(err)),
    close: (code: number) => events.close.forEach((cb) => cb(code)),
    stdout: (chunk: Buffer) => stdout.forEach((cb) => cb(chunk)),
    stderr: (chunk: Buffer) => stderr.forEach((cb) => cb(chunk)),
  };
}

const ctx: import('./scrape-source.interface').HttpExtractContext = {
  episodeUrl: 'https://meusanimes.blog/e/x-1/',
  ua: 'ua',
};

const okJson = () =>
  Buffer.from(
    JSON.stringify({
      videos: ['a.mp4'],
      iframes: [],
      cloudflare: false,
      playerTokens: [],
    }),
  );

describe('runRustScraper', () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it('resolve com resultado válido quando close code 0', async () => {
    const m = makeChild();
    const p = runRustScraper('/bin/rust', ctx);
    m.stdout(okJson());
    m.close(0);
    await expect(p).resolves.toEqual({
      videos: ['a.mp4'],
      iframes: [],
      cloudflare: false,
      playerTokens: [],
    });
    expect(spawnMock).toHaveBeenCalledWith('/bin/rust', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  it('rejeita quando o binário não existe (error event)', async () => {
    const m = makeChild();
    const p = runRustScraper('/nope', ctx);
    m.emitError(new Error('ENOENT'));
    await expect(p).rejects.toThrow('ENOENT');
  });

  it('rejeita com stderr quando close code diferente de 0', async () => {
    const m = makeChild();
    const p = runRustScraper('/bin/rust', ctx);
    m.stderr(Buffer.from('boom rust'));
    m.close(1);
    await expect(p).rejects.toThrow('boom rust');
  });

  it('rejeita ao estourar o limite de saída', async () => {
    const m = makeChild();
    const p = runRustScraper('/bin/rust', ctx);
    m.stdout(Buffer.alloc(5 * 1024 * 1024 + 1));
    m.close(0);
    await expect(p).rejects.toThrow('excedeu o limite');
  });

  it('rejeita quando a saída não é JSON válido', async () => {
    const m = makeChild();
    const p = runRustScraper('/bin/rust', ctx);
    m.stdout(Buffer.from('not json'));
    m.close(0);
    await expect(p).rejects.toThrow();
  });

  it('rejeita com mensagem tipada quando o JSON tem shape inválido', async () => {
    const m = makeChild();
    const p = runRustScraper('/bin/rust', ctx);
    m.stdout(Buffer.from(JSON.stringify({ videos: 'x' })));
    m.close(0);
    await expect(p).rejects.toThrow('Saída inválida do scraper Rust');
  });

  it('rejeita com mensagem tipada quando o JSON tem rejeição não-Error', async () => {
    const m = makeChild();
    const p = runRustScraper('/bin/rust', ctx);
    m.stdout(Buffer.from(JSON.stringify({ videos: '../../../x' })));
    m.close(0);
    await expect(p).rejects.toThrow();
  });
});
