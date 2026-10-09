import { economyConfig } from './economy.config';

describe('economyConfig', () => {
  it('adds new foils to legacy snapshots at their configured odds and values', () => {
    const config = economyConfig({
      foil_weights: { NORMAL: 85, HOLO: 12, GOLD: 3 },
      foil_mult: { NORMAL: 1, HOLO: 3, GOLD: 10 },
    });

    expect(config.foil_weights).toEqual({
      NORMAL: 79,
      HOLO: 12,
      GOLD: 3,
      INK: 3,
      PRISM: 3,
    });
    expect(config.foil_mult.INK).toBe(config.foil_mult.GOLD);
    expect(config.foil_mult.PRISM).toBe(5);
  });
});
