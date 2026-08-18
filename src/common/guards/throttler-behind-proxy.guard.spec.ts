import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerBehindProxyGuard } from '@/common/guards/throttler-behind-proxy.guard';

interface TrackRequest {
  headers?: Record<string, string>;
  ip?: string;
}

class GuardUnderTest extends ThrottlerBehindProxyGuard {
  public track(req: TrackRequest): Promise<string> {
    return this.getTracker(req);
  }
}

function makeGuard(): GuardUnderTest {
  const storage = {
    increment: jest.fn(async () => ({ totalHits: 1, timeToExpire: 60_000 })),
  } as unknown as ThrottlerStorage;
  return new GuardUnderTest(
    {
      throttlers: [{ name: 'default', ttl: 60_000, limit: 10_000 }],
    },
    storage,
    new Reflector(),
  );
}

describe('ThrottlerBehindProxyGuard', () => {
  const ORIG_TRUST_PROXY = process.env.TRUST_PROXY;

  afterEach(() => {
    if (ORIG_TRUST_PROXY === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = ORIG_TRUST_PROXY;
  });

  it('sem TRUST_PROXY usa o socket IP (não confia header)', async () => {
    process.env.TRUST_PROXY = 'false';
    const guard = makeGuard();
    const tracker = await guard.track({
      headers: {
        'cf-connecting-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.7, 10.0.0.1',
      },
      ip: '172.17.0.2',
    });
    expect(tracker).toBe('ip:172.17.0.2');
  });

  it('com TRUST_PROXY=true prioriza CF-Connecting-IP válido', async () => {
    process.env.TRUST_PROXY = 'true';
    const guard = makeGuard();
    const tracker = await guard.track({
      headers: {
        'cf-connecting-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.7, 10.0.0.1',
      },
      ip: '172.17.0.2',
    });
    expect(tracker).toBe('cf:203.0.113.10');
  });

  it('com TRUST_PROXY=true, CF-Connecting-IP inválido cai no xff (primeiro hop)', async () => {
    process.env.TRUST_PROXY = 'true';
    const guard = makeGuard();
    const tracker = await guard.track({
      headers: {
        'cf-connecting-ip': 'nacerto.hacker',
        'x-forwarded-for': '198.51.100.7, 10.0.0.1',
      },
      ip: '172.17.0.2',
    });
    expect(tracker).toBe('xff:198.51.100.7');
  });

  it('headers totalmente corrompidos caem no socket IP mesmo com TRUST_PROXY=true', async () => {
    process.env.TRUST_PROXY = 'true';
    const guard = makeGuard();
    const tracker = await guard.track({
      headers: {
        'cf-connecting-ip': 'spoofed',
        'x-forwarded-for': 'not-an-ip, 10.0.0.1',
      },
      ip: '172.17.0.2',
    });
    expect(tracker).toBe('ip:172.17.0.2');
  });
});
