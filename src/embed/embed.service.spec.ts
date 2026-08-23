import {
  BadRequestException,
  BadGatewayException,
  NotFoundException,
} from '@nestjs/common';
import { lookup } from 'dns/promises';
import { Readable } from 'stream';
import { EmbedService } from './embed.service';

// Mock do DNS: o serviço resolve o host contra a blocklist de IPs internos
// (anti-SSRF). Por padrão toda resolução devolve um IP público; cada teste
// pode sobrescrever via mockedLookup.mockResolvedValueOnce(...).
jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockedLookup = lookup as jest.Mock;

/** IP público de exemplo (não bloqueado por isBlockedIp). */
const PUBLIC_IP = '93.184.216.34';

describe('EmbedService (proxy HTML/mídia + anti-SSRF)', () => {
  let service: EmbedService;
  const originalFetch = global.fetch;

  beforeAll(() => {
    // A allowlist de saída (EMBED_ALLOWED_HOSTS) é injetada pelo setupFiles
    // (test/setup-env.js), que roda antes de qualquer import — assim o módulo
    // sob teste e as exceções de @nestjs/common compartilham o mesmo registro
    // (sem require/jest.resetModules, sem problemas de identidade de classe).
    service = new EmbedService();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    service = new EmbedService();
    jest.clearAllMocks();
    mockedLookup.mockResolvedValue([{ address: PUBLIC_IP }]);
    global.fetch = jest.fn();
  });

  it('aceita URL https válida e canoniciza porta redundante', () => {
    expect(service.normalizeUrl('https://animefire.io/animes/x/1')).toBe(
      'https://animefire.io/animes/x/1',
    );
    expect(service.normalizeUrl('https://animefire.io:443/x')).toBe(
      'https://animefire.io/x',
    );
  });

  it('rejeita scheme inválido, credenciais e portas não padrão', () => {
    expect(() => service.normalizeUrl('javascript:alert(1)')).toThrow(
      BadRequestException,
    );
    expect(() => service.normalizeUrl('ftp://animefire.io/x')).toThrow(
      BadRequestException,
    );
    expect(() =>
      service.normalizeUrl('https://user:pass@animefire.io/x'),
    ).toThrow(BadRequestException);
    expect(() => service.normalizeUrl('https://animefire.io:8443/x')).toThrow(
      BadRequestException,
    );
  });

  it.each([
    'http://localhost/x',
    'http://127.0.0.1/x',
    'http://10.0.0.5/x',
    'http://192.168.1.10/x',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x',
    'http://[fc00::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'http://metadata.google.internal/x',
  ])('bloqueia rede interna/metadata: %s', (url) => {
    expect(() => service.normalizeUrl(url)).toThrow(BadRequestException);
  });

  it('rejeita host fora da allowlist (fail closed)', () => {
    expect(() => service.normalizeUrl('https://evil.com/x')).toThrow(
      'Host de destino não permitido',
    );
  });

  it('proxyHtml baixa, injeta <base>, reescreve recursos e filtra headers', async () => {
    const html =
      '<html><head></head><body>' +
      '<a href="/ep/1">ep</a><img src="img/a.png" />' +
      '<script src="//cdn.animefire.io/a.js"></script>' +
      '<a href="javascript:void(0)">x</a></body></html>';
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'x-secret': '1', 'cache-control': 'public, max-age=60' },
      }),
    );

    const res = await service.proxyHtml('https://animefire.io/page');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['x-secret']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body).toContain('<base href="https://animefire.io"');
    expect(res.body).toContain('href="https://animefire.io/ep/1"');
    expect(res.body).not.toContain('src="img/a.png"');
    expect(res.body).not.toContain('href="javascript:');
    expect(res.body).toContain('data-animesice-watch-party-bridge');
    expect(res.body).toContain("const TYPE = 'animesice:watch-party'");

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://animefire.io/page');
    expect(init.headers['user-agent']).toContain('Chrome');
  });

  it('proxyHtml repassa 404 como NotFoundException', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('nf', { status: 404 }),
    );
    await expect(service.proxyHtml('https://animefire.io/x')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('proxyHtml converte falha de rede em BadGatewayException', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.proxyHtml('https://animefire.io/x')).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('proxyHtml converte timeout (AbortError) em BadGatewayException', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    (global.fetch as jest.Mock).mockRejectedValue(err);
    await expect(service.proxyHtml('https://animefire.io/x')).rejects.toThrow(
      'Tempo limite',
    );
  });

  it('proxyHtml aborta corpo acima do teto (anti memory-bloat)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('x'.repeat(5 * 1024 * 1024 + 1), { status: 200 }),
    );
    await expect(service.proxyHtml('https://animefire.io/x')).rejects.toThrow(
      'Página destino muito grande',
    );
  });

  it('proxyMedia injeta Referer/Origin anti-hotlinking e repassa Range', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(Buffer.from('data'), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-99/100',
          'x-random': 'x',
        },
      }),
    );

    const res = await service.proxyMedia(
      'https://cdn.animefire.io/v.mp4',
      {
        range: 'bytes=0-99',
        cookie: 'secret',
        authorization: 'Bearer t',
        referer: 'https://evil.com',
        'accept-encoding': 'gzip',
      },
      'https://animefire.io',
    );

    expect(res.status).toBe(206);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['content-range']).toBe('bytes 0-99/100');
    expect(res.headers['x-random']).toBeUndefined();
    expect(res.body).toBeInstanceOf(Readable);

    const chunks: Buffer[] = [];
    for await (const chunk of res.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('data');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.referer).toBe('https://animefire.io/');
    expect(init.headers.origin).toBe('https://animefire.io');
    expect(init.headers.range).toBe('bytes=0-99');
    expect(init.headers.cookie).toBeUndefined();
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers['accept-encoding']).toBeUndefined();
  });

  it('proxyMedia repassa erro upstream (403) sem mascarar', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('forbidden', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const res = await service.proxyMedia('https://cdn.animefire.io/v.mp4');
    expect(res.status).toBe(403);
    expect(res.headers['x-proxy-error']).toBe('upstream-403');
  });

  it('proxyMedia infere content-type pela extensão quando upstream omite', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(Buffer.from('x'), { status: 200 }),
    );
    const res = await service.proxyMedia('https://cdn.animefire.io/seg.m3u8');
    expect(res.headers['content-type']).toBe('application/vnd.apple.mpegurl');
  });

  it('bloqueia redirect 302 para IP interno (anti DNS rebinding)', async () => {
    mockedLookup
      .mockResolvedValueOnce([{ address: PUBLIC_IP }]) // animefire.io (página)
      .mockResolvedValueOnce([{ address: '10.0.0.1' }]); // cdn (redirect)
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://cdn.animefire.io/steal' },
      }),
    );
    // O bloqueio ocorre dentro do fetch (fetchSafe); o proxyHtml o envolve em
    // BadGatewayException preservando a mensagem de destino bloqueado.
    await expect(
      service.proxyHtml('https://animefire.io/page'),
    ).rejects.toThrow(/Destino bloqueado/);
  });

  it('aborta após o limite de redirecionamentos', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://animefire.io/again' },
      }),
    );
    await expect(
      service.proxyHtml('https://animefire.io/start'),
    ).rejects.toThrow(BadGatewayException);
  });
});
