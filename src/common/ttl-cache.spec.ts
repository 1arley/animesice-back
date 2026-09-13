import { TtlCache } from '@/common/ttl-cache';

describe('TtlCache', () => {
  it('acerta antes do TTL e erra depois', () => {
    const now = 1_000_000;
    const dateNow = jest.spyOn(Date, 'now');
    dateNow.mockReturnValue(now);
    const cache = new TtlCache<string>(50);
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    dateNow.mockReturnValue(now + 60);
    expect(cache.get('k')).toBeUndefined();
    dateNow.mockRestore();
  });

  it('expulsa o mais antigo ao passar do teto (bounded, sem OOM)', () => {
    const cache = new TtlCache<number>(10_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // estoura o teto -> 'a' sai
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });
});
