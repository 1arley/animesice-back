import {
  clearLivenessCache,
  shouldReextractMedia,
  signedExpiryDead,
  probeMediaUrlDead,
  purgeExpiredLivenessCache,
} from '@/common/media-probe';

jest.mock('@/common/ssrf', () => ({
  resolveSafeUrl: jest.fn(async (url: string) => ({ url })),
  pinnedDispatcher: jest.fn(() => ({ close: jest.fn() })),
}));

describe('signedExpiryDead', () => {
  it('retorna true para expire (unix) no passado', () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(signedExpiryDead(`https://cdn.test/v.mp4?expire=${past}`)).toBe(
      true,
    );
  });

  it('retorna false para expire (unix) no futuro', () => {
    const future = Math.floor(Date.now() / 1000) + 60;
    expect(signedExpiryDead(`https://cdn.test/v.mp4?expire=${future}`)).toBe(
      false,
    );
  });

  it('retorna true para assinatura AWS S3 vencida (X-Amz-Date + X-Amz-Expires)', () => {
    const url =
      'https://hugh.cdn.rumble.cloud/v.mp4?X-Amz-Date=20260728T160632Z&X-Amz-Expires=10800&X-Amz-Signature=abc';
    expect(signedExpiryDead(url)).toBe(true);
  });

  it('retorna null quando não há params de expiração', () => {
    expect(signedExpiryDead('https://cdn.test/v.mp4')).toBe(null);
    expect(signedExpiryDead('https://cdn.test/v.mp4?token=x')).toBe(null);
  });

  it('retorna null para URL malformada', () => {
    expect(signedExpiryDead('not a url')).toBe(null);
  });
});

describe('probeMediaUrlDead', () => {
  beforeEach(() => clearLivenessCache());

  it('retorna true para URL S3 expirada sem depender da rede', async () => {
    const fetchFn = jest.fn();
    global.fetch = fetchFn as any;
    const dead = await probeMediaUrlDead(
      'https://hugh.cdn.rumble.cloud/v.mp4?X-Amz-Date=20260728T160632Z&X-Amz-Expires=10800',
    );
    expect(dead).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('retorna false para googlevideo com expire futuro (sem rede)', async () => {
    // Inclusive perto do vencimento: o timestamp ainda é determinístico e um
    // probe remoto aqui só adicionaria latência ao /stream/source.
    const future = Math.floor(Date.now() / 1000) + 60;
    global.fetch = jest.fn() as any;
    const dead = await probeMediaUrlDead(
      `https://rr2---sn.test.googlevideo.com/videoplayback?expire=${future}&cver=1`,
    );
    expect(dead).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('probe forçado confirma na rede mesmo com expire futuro', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    global.fetch = jest.fn(async () => ({
      status: 403,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    })) as any;

    const dead = await probeMediaUrlDead(
      `https://rr2---sn.test.googlevideo.com/videoplayback?expire=${future}`,
      true,
    );

    expect(dead).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('considera 404/403/410 como morta', async () => {
    for (const status of [403, 404, 410]) {
      global.fetch = jest.fn(async () => ({
        status,
        headers: { get: () => null },
        body: { cancel: jest.fn() },
      })) as any;
      expect(await probeMediaUrlDead('https://cdn.test/v.mp4')).toBe(true);
    }
  });

  it('rejeita 500 da CDN e refaz o probe forçado após sucesso em cache', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 206,
        headers: new Headers(),
        body: null,
      })
      .mockResolvedValue({ status: 500, headers: new Headers(), body: null });
    const url = 'https://vidcache.net:8161/token/video.mp4';
    expect(await probeMediaUrlDead(url, true)).toBe(false);
    expect(await probeMediaUrlDead(url, true)).toBe(true);
    expect(await probeMediaUrlDead(url)).toBe(true);
  });

  it('considera 200/206 como viva', async () => {
    global.fetch = jest.fn(async () => ({
      status: 206,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    })) as any;
    expect(await probeMediaUrlDead('https://cdn.test/v.mp4')).toBe(false);
  });

  it('considera erro de rede como inconclusivo (viva)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as any;
    expect(await probeMediaUrlDead('https://cdn.test/v.mp4')).toBe(false);
  });

  it('não confirma vida em recuperação quando a rede falha', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    expect(await probeMediaUrlDead('https://cdn.test/timeout.mp4', true)).toBe(
      true,
    );
  });

  it('reutiliza probe em andamento e resultado vivo no TTL', async () => {
    let resolveFetch!: (value: unknown) => void;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as any;

    const first = probeMediaUrlDead('https://cdn.test/shared.mp4');
    const second = probeMediaUrlDead('https://cdn.test/shared.mp4');
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch({
      status: 206,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    });
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    await expect(
      probeMediaUrlDead('https://cdn.test/shared.mp4'),
    ).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('remove resultados de liveness vencidos', async () => {
    global.fetch = jest.fn(async () => ({
      status: 206,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    })) as any;
    await probeMediaUrlDead('https://cdn.test/expiring.mp4');
    expect(purgeExpiredLivenessCache(Date.now() + 1_800_001)).toBe(1);
  });
});

describe('shouldReextractMedia', () => {
  it.each([401, 403, 404, 410, 500, 502, 503, 599])(
    'retorna true para status %i',
    (status) => {
      expect(shouldReextractMedia(status)).toBe(true);
    },
  );

  it.each([200, 206, 301, 302, 429])(
    'retorna false para status %i',
    (status) => {
      expect(shouldReextractMedia(status)).toBe(false);
    },
  );
});

describe('probeMediaUrlDead (cobertura de recuperação)', () => {
  beforeEach(() => clearLivenessCache());

  it('usa dispatcher global fora do ambiente de teste', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = '';
    const fetchFn = jest.fn();
    global.fetch = fetchFn as any;
    try {
      // undici real com dispatcher mockado rejeita -> inconclusivo sem forçar.
      await expect(
        probeMediaUrlDead('https://cdn.test/noproxy.mp4'),
      ).resolves.toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('purge sem argumentos usa Date.now e mantém vivos', async () => {
    global.fetch = jest.fn(async () => ({
      status: 206,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    })) as any;
    await probeMediaUrlDead('https://cdn.test/keep.mp4');
    expect(purgeExpiredLivenessCache()).toBe(0);
  });

  it('evicta por tamanho quando o cache excede 500 entradas', async () => {
    global.fetch = jest.fn(async () => ({
      status: 206,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    })) as any;
    for (let i = 0; i < 501; i++) {
      await probeMediaUrlDead(`https://cdn.test/evict${i}.mp4`);
    }
    expect(purgeExpiredLivenessCache()).toBeGreaterThanOrEqual(1);
  });

  it('segue redirecionamento e avalia o destino final', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location' ? '/final.mp4' : null,
        },
        body: { cancel: jest.fn() },
      })
      .mockResolvedValue({
        status: 206,
        headers: { get: () => null },
        body: { cancel: jest.fn() },
      }) as any;
    await expect(probeMediaUrlDead('https://cdn.test/start.mp4')).resolves.toBe(
      false,
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('trata redirecionamento inválido como morta', async () => {
    global.fetch = jest.fn(async () => ({
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location' ? 'http://[invalido' : null,
      },
      body: { cancel: jest.fn() },
    })) as any;
    await expect(
      probeMediaUrlDead('https://cdn.test/badredir.mp4'),
    ).resolves.toBe(true);
  });

  it('trata estouro de redirecionamentos como morta', async () => {
    global.fetch = jest.fn(async () => ({
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location' ? '/loop.mp4' : null,
      },
      body: { cancel: jest.fn() },
    })) as any;
    await expect(probeMediaUrlDead('https://cdn.test/loop.mp4')).resolves.toBe(
      true,
    );
    expect(global.fetch).toHaveBeenCalledTimes(6);
  });

  it('re-probeia quando o cache venceu', async () => {
    const fetchFn = jest.fn(async () => ({
      status: 206,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    }));
    global.fetch = fetchFn as any;
    await expect(probeMediaUrlDead('https://cdn.test/stale.mp4')).resolves.toBe(
      false,
    );
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 1_800_001);
    try {
      await expect(
        probeMediaUrlDead('https://cdn.test/stale.mp4'),
      ).resolves.toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('ignora limpeza de inflight quando outro probe assumiu a chave', async () => {
    let resolveFetch!: (value: unknown) => void;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as any;
    const first = probeMediaUrlDead('https://cdn.test/race.mp4');
    await Promise.resolve();
    await Promise.resolve();
    clearLivenessCache();
    resolveFetch({
      status: 206,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    });
    await expect(first).resolves.toBe(false);
  });
});

describe('signedExpiryDead (casos de borda)', () => {
  it('retorna null para X-Amz-Date malformado', () => {
    expect(
      signedExpiryDead(
        'https://cdn.test/v.mp4?X-Amz-Date=not-a-date&X-Amz-Expires=100',
      ),
    ).toBe(null);
  });

  it('aplica defaults de hora quando a data só tem dia', () => {
    expect(
      signedExpiryDead(
        'https://cdn.test/v.mp4?X-Amz-Date=20200101&X-Amz-Expires=60',
      ),
    ).toBe(true);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(
      signedExpiryDead(
        `https://cdn.test/v.mp4?X-Amz-Date=${today}&X-Amz-Expires=86400`,
      ),
    ).toBe(false);
  });

  it('retorna null para expire zerado ou fora do inteiro seguro', () => {
    expect(signedExpiryDead('https://cdn.test/v.mp4?expire=0')).toBe(null);
    expect(
      signedExpiryDead('https://cdn.test/v.mp4?expire=99999999999999999999999'),
    ).toBe(null);
  });
});
