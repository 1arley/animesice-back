import { lookup } from 'dns/promises';
import { BadRequestException, BadGatewayException } from '@nestjs/common';
import {
  isBlockedIp,
  isBlockedHostname,
  resolveSafeUrl,
  pinnedDispatcher,
  assertHostResolvesSafely,
  fetchSafeRaw,
} from '@/common/ssrf';
import { Agent, fetch as undiciFetch } from 'undici';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

jest.mock('undici', () => {
  const actual = jest.requireActual('undici');
  return { ...actual, fetch: jest.fn() };
});

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;
const mockedUndiciFetch = undiciFetch as jest.MockedFunction<
  typeof undiciFetch
>;

function lookupSuccess(...addresses: Array<[string, number]>) {
  mockedLookup.mockResolvedValueOnce(
    addresses.map(([address, family]) => ({ address, family })) as any,
  );
}

describe('SSRF DNS pinning', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
    mockedUndiciFetch.mockReset();
  });

  it('usa no connect apenas o IP público validado, mesmo após rebinding', async () => {
    mockedLookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as any);

    const resolution = await resolveSafeUrl('https://cdn.example/video.mp4');
    const connected = await new Promise<{ address: string; family: number }>(
      (resolve, reject) => {
        resolution.lookup('cdn.example', { family: 0, all: false }, ((
          error: Error | null,
          address: string,
          family: number,
        ) => {
          if (error) reject(error);
          else resolve({ address, family });
        }) as never);
      },
    );

    expect(connected).toEqual({ address: '8.8.8.8', family: 4 });
    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  it('bloqueia se qualquer resposta DNS for privada', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ] as any);
    await expect(
      resolveSafeUrl('https://cdn.example/video.mp4'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bloqueia IPv4 privado mapeado em IPv6 hexadecimal', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '::ffff:7f00:1', family: 6 },
    ] as any);
    await expect(
      resolveSafeUrl('https://cdn.example/video.mp4'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lookup pinado recusa hostname diferente do validado', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
    ] as any);
    const resolution = await resolveSafeUrl('https://cdn.example/video.mp4');

    await expect(
      new Promise((resolve, reject) => {
        resolution.lookup('internal.example', {}, (error) =>
          error ? reject(error) : resolve(undefined),
        );
      }),
    ).rejects.toThrow('hostname não validado');
  });
});

describe('isBlockedIp', () => {
  it('bloqueia IPs privados/reservados IPv4', () => {
    expect(isBlockedIp('10.0.0.7')).toBe(true);
    expect(isBlockedIp('172.16.5.5')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('0.0.0.0')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('100.64.0.1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });

  it('bloqueia IPv6 reservados e aceita públicos', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('::')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
    expect(isBlockedIp('64:ff9b::1')).toBe(true);
    expect(isBlockedIp('ff00::1')).toBe(true);
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false);
  });

  it('retorna true para string que não é um IP', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it('bloqueia localhost e metadata (com colchetes e case-insensitive)', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('LOCALHOST')).toBe(true);
    expect(isBlockedHostname('[localhost]')).toBe(true);
    expect(isBlockedHostname('metadata.google.internal')).toBe(true);
  });

  it('bloqueia hostname que é IP literal', () => {
    expect(isBlockedHostname('127.0.0.1')).toBe(true);
    expect(isBlockedHostname('10.0.0.5')).toBe(true);
    expect(isBlockedHostname('::1')).toBe(true);
    expect(isBlockedHostname('8.8.8.8')).toBe(false);
  });

  it('bloqueia notação hexadecimal/octal de IP', () => {
    expect(isBlockedHostname('0x7f.0.0.1')).toBe(true);
    expect(isBlockedHostname('0177.0.0.1')).toBe(true);
  });

  it('libera hostnames comuns', () => {
    expect(isBlockedHostname('cdn.example.com')).toBe(false);
    expect(isBlockedHostname('player.test')).toBe(false);
  });
});

describe('resolveSafeUrl (validação)', () => {
  beforeEach(() => mockedLookup.mockReset());

  it('rejeita URL malformada', async () => {
    await expect(resolveSafeUrl('não é uma url')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita scheme que não é http(s)', async () => {
    await expect(
      resolveSafeUrl('ftp://cdn.example/v.mp4'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(resolveSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita hostname bloqueado antes do DNS', async () => {
    await expect(resolveSafeUrl('https://localhost/x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      resolveSafeUrl('https://metadata.google.internal/x'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(resolveSafeUrl('https://0x7f.0.0.1/x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejeita IP literal privado', async () => {
    await expect(resolveSafeUrl('https://10.0.0.7/x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(resolveSafeUrl('https://127.0.0.1/x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resolve IP literal público sem consultar DNS', async () => {
    const resolution = await resolveSafeUrl('https://8.8.8.8/x?q=1');
    expect(resolution.hostname).toBe('8.8.8.8');
    expect(resolution.addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('resolve IPv6 literal público', async () => {
    const resolution = await resolveSafeUrl('http://[2001:4860:4860::8888]/x');
    expect(resolution.hostname).toBe('2001:4860:4860::8888');
    expect(resolution.addresses).toEqual([
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
  });

  it('rejeita quando o DNS falha', async () => {
    mockedLookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(
      resolveSafeUrl('https://cdn.example/x'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita quando o DNS não resolve nenhum endereço', async () => {
    mockedLookup.mockResolvedValueOnce([] as any);
    await expect(
      resolveSafeUrl('https://cdn.example/x'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normaliza a URL de saída', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
    ] as any);
    const resolution = await resolveSafeUrl('https://cdn.example:443/v.mp4');
    expect(resolution.url).toBe('https://cdn.example/v.mp4');
  });
});

describe('lookup pinado (família e all)', () => {
  beforeEach(() => mockedLookup.mockReset());

  it('suporta all, filtro por família e options numérico', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860::1', family: 6 },
    ] as any);
    const resolution = await resolveSafeUrl('https://cdn.example/x');

    const all = await new Promise<any[]>((resolve, reject) => {
      resolution.lookup('cdn.example', { family: 0, all: true }, ((
        err: Error | null,
        addrs: any,
      ) => (err ? reject(err) : resolve(addrs))) as never);
    });
    expect(all).toHaveLength(2);

    const v4 = await new Promise<any>((resolve, reject) => {
      resolution.lookup('cdn.example', { family: 4, all: false }, ((
        err: Error | null,
        addr: any,
        fam: any,
      ) => (err ? reject(err) : resolve({ addr, fam }))) as never);
    });
    expect(v4).toEqual({ addr: '8.8.8.8', fam: 4 });

    const v6 = await new Promise<any>((resolve, reject) => {
      resolution.lookup('cdn.example', { family: 6, all: false }, ((
        err: Error | null,
        addr: any,
        fam: any,
      ) => (err ? reject(err) : resolve({ addr, fam }))) as never);
    });
    expect(v6).toEqual({ addr: '2001:4860::1', fam: 6 });

    const numeric = await new Promise<any>((resolve, reject) => {
      resolution.lookup(
        'cdn.example',
        4 as any,
        ((err: Error | null, addr: any, fam: any) =>
          err ? reject(err) : resolve({ addr, fam })) as never,
      );
    });
    expect(numeric).toEqual({ addr: '8.8.8.8', fam: 4 });
  });

  it('rejeita quando não há IP validado para a família solicitada', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
    ] as any);
    const resolution = await resolveSafeUrl('https://cdn.example/x');
    await expect(
      new Promise((resolve, reject) => {
        resolution.lookup(
          'cdn.example',
          { family: 6, all: false },
          (err: Error | null) => (err ? reject(err) : resolve(undefined)),
        );
      }),
    ).rejects.toThrow('Nenhum IP');
  });
});

describe('pinnedDispatcher e assertHostResolvesSafely', () => {
  beforeEach(() => mockedLookup.mockReset());

  it('pinnedDispatcher cria um Agent com lookup pinado', async () => {
    const dispatcher = pinnedDispatcher({ lookup: jest.fn() } as any);
    expect(dispatcher).toBeInstanceOf(Agent);
    await dispatcher.close();
  });

  it('assertHostResolvesSafely valida uma URL sem retornar nada', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
    ] as any);
    await expect(
      assertHostResolvesSafely('https://cdn.example/v.mp4'),
    ).resolves.toBeUndefined();
  });
});

describe('fetchSafeRaw', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
    mockedUndiciFetch.mockReset();
  });

  function okResponse(status = 200, location: string | null = null) {
    return {
      status,
      headers: { get: () => location },
      body: null,
    } as any;
  }

  it('faz fetch único com dispatcher pinado e retorna a resposta', async () => {
    lookupSuccess(['8.8.8.8', 4]);
    mockedUndiciFetch.mockResolvedValueOnce(okResponse(200));
    const { response, dispatcher } = await fetchSafeRaw(
      'https://cdn.example/v.mp4',
      {},
      5000,
    );
    expect(response.status).toBe(200);
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedUndiciFetch.mock.calls[0]!;
    expect(url).toBe('https://cdn.example/v.mp4');
    expect(init!.redirect).toBe('manual');
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(init!.dispatcher).toBeDefined();
    await dispatcher.close();
  });

  it('segue redirecionamento revalidando o próximo hop', async () => {
    lookupSuccess(['8.8.8.8', 4]);
    lookupSuccess(['8.8.4.4', 4]);
    mockedUndiciFetch
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: () => 'https://cdn2.example/final.mp4' },
        body: { cancel: jest.fn().mockResolvedValue(undefined) },
      } as any)
      .mockResolvedValueOnce(okResponse(200));
    const { response } = await fetchSafeRaw(
      'https://cdn.example/a.mp4',
      {},
      5000,
    );
    expect(response.status).toBe(200);
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    expect(mockedUndiciFetch.mock.calls[1]![0]).toBe(
      'https://cdn2.example/final.mp4',
    );
    expect(mockedLookup).toHaveBeenCalledTimes(2);
  });

  it('propaga erro de fetch e fecha o dispatcher', async () => {
    lookupSuccess(['8.8.8.8', 4]);
    mockedUndiciFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const closeSpy = jest
      .spyOn(Agent.prototype, 'close')
      .mockResolvedValue(undefined);
    await expect(
      fetchSafeRaw('https://cdn.example/a.mp4', {}, 5000),
    ).rejects.toThrow('ECONNREFUSED');
    expect(closeSpy).toHaveBeenCalled();
    closeSpy.mockRestore();
  });

  it('aborta a requisição quando o timeout dispara', async () => {
    lookupSuccess(['8.8.8.8', 4]);
    mockedUndiciFetch.mockImplementationOnce(
      (_url, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    await expect(
      fetchSafeRaw('https://cdn.example/a.mp4', {}, 10),
    ).rejects.toThrow('aborted');
  });

  it('não segue redirecionamento sem header location', async () => {
    lookupSuccess(['8.8.8.8', 4]);
    mockedUndiciFetch.mockResolvedValueOnce(okResponse(302));
    const { response } = await fetchSafeRaw(
      'https://cdn.example/a.mp4',
      {},
      5000,
    );
    expect(response.status).toBe(302);
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('rejeita redirecionamento com URL inválida', async () => {
    lookupSuccess(['8.8.8.8', 4]);
    mockedUndiciFetch.mockResolvedValueOnce({
      status: 302,
      headers: { get: () => 'http://[::1' },
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    } as any);
    await expect(
      fetchSafeRaw('https://cdn.example/a.mp4', {}, 5000),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('estoura o limite de redirecionamentos', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);
    mockedUndiciFetch.mockResolvedValue({
      status: 302,
      headers: { get: () => 'https://cdn.example/next' },
      body: { cancel: jest.fn().mockResolvedValue(undefined) },
    } as any);
    await expect(
      fetchSafeRaw('https://cdn.example/a.mp4', {}, 5000),
    ).rejects.toThrow('Limite de redirecionamentos');
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(6);
  });

  it('segue redirecionamento mesmo com body nulo no 3xx', async () => {
    lookupSuccess(['8.8.8.8', 4]);
    lookupSuccess(['8.8.4.4', 4]);
    mockedUndiciFetch
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: () => 'https://cdn2.example/final.mp4' },
        body: null,
      } as any)
      .mockResolvedValueOnce(okResponse(200));
    const { response, dispatcher } = await fetchSafeRaw(
      'https://cdn.example/a.mp4',
      {},
      5000,
    );
    expect(response.status).toBe(200);
    await dispatcher.close();
  });
});
