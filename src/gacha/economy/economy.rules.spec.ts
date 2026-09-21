import {
  BOX_TOTAL_COST,
  crystalPackage,
  dayKey,
  officialPrice,
  prizeAmount,
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
    expect(prizeAmount('CRYSTAL', 'COMMON', 'BASIC')).toBe(
      BOX_TOTAL_COST.COMMON * 0.2,
    );
    expect(prizeAmount('KEY', 'PREMIUM', 'LEGENDARY')).toBe(3);
    expect(prizeAmount('SPIN_RESET', 'RARE', 'EPIC')).toBe(1);
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
