import { ECONOMY_DEFAULTS, economyConfig } from './economy.config';

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

  it('legacy snapshot keeps historical odds (ITEM weight 0) and default intact', () => {
    const legacy = economyConfig({
      box_category_weights: {
        COMMON: { CRYSTAL: 10 },
      },
    });

    expect(legacy.box_category_weights.COMMON).toEqual({
      ...ECONOMY_DEFAULTS.box_category_weights.COMMON,
      CRYSTAL: 10,
      ITEM: 0,
    });
    expect(legacy.box_category_weights.PREMIUM.ITEM).toBe(0);
    // Defaults compartilhados nunca são mutados pela carga legado.
    expect(ECONOMY_DEFAULTS.box_category_weights.PREMIUM.ITEM).toBe(15);
  });

  it('new snapshot inherits item launch weights per tier', () => {
    const config = economyConfig({
      item_kind_weights: { RARE: { TITANITA: 10 } },
    });

    expect(config.box_category_weights.COMMON.ITEM).toBe(4);
    expect(config.box_category_weights.RARE.ITEM).toBe(6);
    expect(config.box_category_weights.PREMIUM.ITEM).toBe(15);
    expect(config.item_kind_weights.RARE.TITANITA).toBe(10);
    expect(config.item_kind_weights.RARE.SOMBRIA_DRACONICA).toBe(0);
  });

  it('explicit zero weight stays disabled in a new snapshot', () => {
    const config = economyConfig({
      item_kind_weights: { PREMIUM: { DRACONICA: 0 } },
    });

    expect(config.item_kind_weights.PREMIUM.DRACONICA).toBe(0);
  });

  it('rejects a malformed category weights value', () => {
    expect(() => economyConfig({ box_category_weights: [] })).toThrow();
  });
});
