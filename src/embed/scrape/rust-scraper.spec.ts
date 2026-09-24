import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { runRustScraper } from './rust-scraper';
import type { HttpExtractContext } from './scrape-source.interface';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

const spawnMock = jest.mocked(spawn);

const ctx: HttpExtractContext = {
  episodeUrl: 'https://meusanimes.blog/episodio/1',
  ua: 'Mozilla/5.0 (X11; Linux x86_64)',
};

const validOutput = {
  videos: ['https://cdn.test/video.mp4'],
  iframes: ['https://player.test/embed/1'],
  cloudflare: false,
  playerTokens: ['token-1'],
};

function newChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: jest.Mock };
    kill: jest.Mock;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: jest.fn() };
  child.kill = jest.fn();
  spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}

describe('runRustScraper', () => {
  it('resolve com o JSON válido e envia o contexto por stdin', async () => {
    const child = newChild();
    const promise = runRustScraper('./rust-scraper', ctx);
    child.stdout.emit('data', Buffer.from(JSON.stringify(validOutput)));
    child.emit('close', 0);
    await expect(promise).resolves.toEqual(validOutput);
    expect(child.stdin.end).toHaveBeenCalledWith(JSON.stringify(ctx));
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejeita com a saída do stderr quando o código de saída não é zero', async () => {
    const child = newChild();
    const promise = runRustScraper('./rust-scraper', ctx);
    const assertion = expect(promise).rejects.toThrow('panic: boom');
    child.stderr.emit('data', Buffer.from('panic: boom'));
    child.emit('close', 1);
    await assertion;
  });

  it('mata o processo e rejeita quando a saída excede 5 MB', async () => {
    const child = newChild();
    const promise = runRustScraper('./rust-scraper', ctx);
    const assertion = expect(promise).rejects.toThrow(
      'Saída Rust excedeu o limite.',
    );
    child.stdout.emit('data', Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', 0);
    await assertion;
  });

  it('rejeita quando a saída não é JSON válido', async () => {
    const child = newChild();
    const promise = runRustScraper('./rust-scraper', ctx);
    const assertion = expect(promise).rejects.toThrow(SyntaxError);
    child.stdout.emit('data', Buffer.from('não é json'));
    child.emit('close', 0);
    await assertion;
  });

  it.each([
    ['videos não é array', { videos: 'x' }],
    ['iframes não é array', { iframes: 7 }],
    ['playerTokens não é array', { playerTokens: null }],
    ['cloudflare não é booleano', { cloudflare: 'yes' }],
    ['videos com item não-string', { videos: [1] }],
    ['playerTokens com item não-string', { playerTokens: [2] }],
  ])('rejeita saída inválida: %s', async (_label, override) => {
    const child = newChild();
    const promise = runRustScraper('./rust-scraper', ctx);
    const assertion = expect(promise).rejects.toThrow(
      'Saída inválida do scraper Rust.',
    );
    child.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ ...validOutput, ...override })),
    );
    child.emit('close', 0);
    await assertion;
  });

  it('rejeita quando o spawn dispara o evento error', async () => {
    const child = newChild();
    const promise = runRustScraper('./inexistente', ctx);
    const error = Object.assign(new Error('spawn ENOENT'), {
      code: 'ENOENT',
    });
    const assertion = expect(promise).rejects.toBe(error);
    child.emit('error', error);
    await assertion;
  });

  it('rejeita por timeout e encerra o processo com SIGTERM e SIGKILL', async () => {
    jest.useFakeTimers();
    try {
      const child = newChild();
      const promise = runRustScraper('./rust-scraper', ctx);
      const assertion = expect(promise).rejects.toThrow(
        'Timeout no scraper Rust.',
      );
      jest.advanceTimersByTime(32_000);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      jest.advanceTimersByTime(250);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
