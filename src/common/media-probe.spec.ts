import { signedExpiryDead, probeMediaUrlDead } from '@/common/media-probe';

jest.mock('@/common/ssrf', () => ({
  assertHostResolvesSafely: jest.fn().mockResolvedValue(undefined),
  isBlockedHostname: jest.fn().mockReturnValue(false),
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
    const future = Math.floor(Date.now() / 1000) + 3600;
    global.fetch = jest.fn() as any;
    const dead = await probeMediaUrlDead(
      `https://rr2---sn.test.googlevideo.com/videoplayback?expire=${future}&cver=1`,
    );
    expect(dead).toBe(false);
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
});
