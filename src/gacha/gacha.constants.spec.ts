import { burnFragments, GACHA_TIERS } from './gacha.constants';

describe('burnFragments', () => {
  const conditions = [
    ['POOR', 0.8],
    ['PLAYED', 0.5],
    ['EX', 0.2],
    ['NM', 0.1],
    ['MINT', 0.05],
  ] as const;
  const rarities = GACHA_TIERS;

  const expected: readonly (readonly number[])[] = [
    [1, 2, 3, 4, 5, 6, 7],
    [2, 3, 4, 5, 6, 7, 8],
    [3, 4, 5, 6, 7, 8, 9],
    [4, 5, 6, 7, 8, 9, 9],
    [5, 6, 7, 8, 9, 9, 9],
  ];

  it.each(
    conditions.flatMap(([condition, value], row) =>
      rarities.map(
        (rarity, column) =>
          [condition, value, rarity, expected[row]![column]!] as const,
      ),
    ),
  )('calculates %s × %s', (_condition, value, rarity, quantity) => {
    expect(burnFragments(value, rarity, 'HOLO')).toEqual({
      foil: 'HOLO',
      quantity,
    });
  });

  it.each([
    [0.8, 'COMUM', 1],
    [0.05, 'COMUM', 5],
    [0.8, 'GALACTICA', 7],
    [0.05, 'GALACTICA', 9],
    [0.2, 'GALACTICA', 9],
  ] as const)(
    'returns the approved value for %s / %s',
    (condition, rarity, quantity) => {
      expect(burnFragments(condition, rarity, 'PRISM')?.quantity).toBe(
        quantity,
      );
    },
  );

  it('does not grant fragments for NORMAL foil', () => {
    expect(burnFragments(0.05, 'GALACTICA', 'NORMAL')).toBeNull();
  });
});
