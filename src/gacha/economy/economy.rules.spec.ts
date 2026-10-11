import {
  BOX_PRICE,
  CATEGORY_WEIGHTS,
  crystalPackage,
  crystalPrizeAmount,
  dayKey,
  officialPrice,
  prizeAmount,
  prizeQuality,
  QUALITY_WEIGHTS,
  weightedPick,
} from './economy.rules';

describe('economy rules', () => {
  it('vira o dia em America/Sao_Paulo', () => {
    expect(dayKey(new Date('2026-09-20T02:59:59Z'))).toBe('2026-09-19');
    expect(dayKey(new Date('2026-09-20T03:00:00Z'))).toBe('2026-09-20');
  });

  it('seleciona por peso sem depender da ordem dos objetos', () => {
    expect(weightedPick({ A: 50, B: 30, C: 20 }, 0)).toBe('A');
    expect(weightedPick({ A: 50, B: 30, C: 20 }, 0.5)).toBe('B');
    expect(weightedPick({ A: 50, B: 30, C: 20 }, 0.999)).toBe('C');
  });

  it('calcula premios dependentes da qualidade', () => {
    expect(prizeAmount('CRYSTAL', 'COMMON', 'BASIC', 0)).toBe(200);
    expect(prizeAmount('KEY', 'PREMIUM', 'LEGENDARY')).toBe(3);
    expect(prizeAmount('SPIN_RESET', 'RARE', 'EPIC')).toBe(1);
  });

  it('uses the requested box prices and drop distributions', () => {
    expect(BOX_PRICE).toEqual({ COMMON: 500, RARE: 1500, PREMIUM: 5000 });
    expect(
      Object.values(CATEGORY_WEIGHTS).map((weights) =>
        Object.values(weights).reduce((sum, weight) => sum + weight, 0),
      ),
    ).toEqual([100, 100, 100]);
    expect(CATEGORY_WEIGHTS.COMMON).toMatchObject({
      CRYSTAL: 35,
      SPIN_RESET: 15,
      SKIN: 25,
      RARE_BOX: 10,
      KEY_RARE_BOX: 4,
      KEY_PREMIUM_BOX: 1,
    });
    expect(CATEGORY_WEIGHTS.RARE).toMatchObject({
      SPIN_RESET: 20,
      CARD: 25,
      SKIN: 30,
      CARD_BACK: 12,
      KEY_PREMIUM_BOX: 4,
    });
    expect(CATEGORY_WEIGHTS.PREMIUM).toMatchObject({
      SPIN_RESET: 25,
      CARD: 35,
      SKIN: 25,
      CARD_BACK: 10,
      CRYSTAL: 5,
    });
  });

  it('pays Crystal within each box range', () => {
    expect(crystalPrizeAmount('COMMON', 0)).toBe(200);
    expect(crystalPrizeAmount('COMMON', 0.999)).toBe(1500);
    expect(crystalPrizeAmount('RARE', 0)).toBe(800);
    expect(crystalPrizeAmount('RARE', 0.999999)).toBe(2500);
    expect(crystalPrizeAmount('PREMIUM', 0)).toBe(2500);
    expect(crystalPrizeAmount('PREMIUM', 0.999999)).toBe(10000);
    for (let random = 0; random < 1; random += 0.01) {
      expect(crystalPrizeAmount('COMMON', random) % 100).toBe(0);
    }
  });

  it('limits Premium card drops to Epic or Legendary quality', () => {
    expect(prizeQuality('PREMIUM', 'CARD', QUALITY_WEIGHTS, 0)).toBe('EPIC');
    expect(prizeQuality('PREMIUM', 'CARD', QUALITY_WEIGHTS, 0.999)).toBe(
      'LEGENDARY',
    );
  });

  it('usa maior valor entre piso e 135% da mediana', () => {
    expect(officialPrice(500, null)).toBe(500);
    expect(officialPrice(500, 1_000)).toBe(1_350);
  });

  it('aceita somente pacotes oficiais', () => {
    expect(crystalPackage('BRL_990')).toEqual({ cents: 990, crystals: 2_000 });
    expect(() => crystalPackage('BRL_999')).toThrow('Pacote inexistente.');
  });
});
