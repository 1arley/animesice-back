import { VERIFIED_KEY, Verified } from '@/auth/verified.decorator';

describe('Verified decorator', () => {
  it('registra marcação verified como true', () => {
    const target = () => {};

    Verified()(target);

    expect(Reflect.getMetadata(VERIFIED_KEY, target)).toBe(true);
  });

  it('exporta VERIFIED_KEY como string', () => {
    expect(VERIFIED_KEY).toBe('verified');
  });
});
