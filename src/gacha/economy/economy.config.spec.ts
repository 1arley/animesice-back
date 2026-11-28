import {
  ECONOMY_DEFAULTS,
  economyConfig,
  foilExtractFragmentsFor,
} from './economy.config';

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

  it('inherits EXTRATOR_FOIL and foil_extract_fragments defaults in legacy snapshots', () => {
    const legacy = economyConfig({
      item_shop_price: {
        TITANITA: 500,
        TITANITA_SOMBRIA: 1500,
        DRACONICA: 6500,
        SOMBRIA_DRACONICA: 0,
        PROTECAO: 400,
      },
      item_shop_enabled: {
        TITANITA: true,
        TITANITA_SOMBRIA: true,
        DRACONICA: true,
        SOMBRIA_DRACONICA: true,
        PROTECAO: true,
      },
      item_convert_value: {
        TITANITA: 250,
        TITANITA_SOMBRIA: 750,
        DRACONICA: 3250,
        SOMBRIA_DRACONICA: 4500,
        PROTECAO: 0,
      },
    });

    expect(legacy.item_shop_price.EXTRATOR_FOIL).toBe(2000);
    expect(legacy.item_shop_enabled.EXTRATOR_FOIL).toBe(true);
    expect(legacy.item_convert_value.EXTRATOR_FOIL).toBe(0);
    expect(legacy.item_kind_weights.COMMON.EXTRATOR_FOIL).toBe(0);
    expect(foilExtractFragmentsFor(legacy, 'HOLO')).toBe(10);
  });

  it('applies default foil_extract_fragments and per-foil overrides', () => {
    const byDefault = economyConfig({
      foil_extract_fragments: { default: 8 },
    });
    expect(foilExtractFragmentsFor(byDefault, 'HOLO')).toBe(8);
    expect(foilExtractFragmentsFor(byDefault, 'PRISM')).toBe(8);

    const overridden = economyConfig({
      foil_extract_fragments: { default: 8, GOLD: 14, NEGATIVE: 99 },
    });
    expect(foilExtractFragmentsFor(overridden, 'HOLO')).toBe(8);
    expect(foilExtractFragmentsFor(overridden, 'GOLD')).toBe(14);
  });

  it('rejects invalid foil_extract_fragments and non-zero extractor convert values', () => {
    expect(() =>
      economyConfig({ foil_extract_fragments: { default: 0 } }),
    ).toThrow();
    expect(() =>
      economyConfig({ foil_extract_fragments: { default: 20 } }),
    ).toThrow();
    expect(() =>
      economyConfig({ foil_extract_fragments: { default: 10, INK: 20 } }),
    ).toThrow();
    expect(() =>
      economyConfig({ foil_extract_fragments: { default: 10.5 } }),
    ).toThrow();
    expect(() => economyConfig({ foil_extract_fragments: {} })).toThrow();
    expect(() =>
      economyConfig({ item_convert_value: { EXTRATOR_FOIL: 100 } }),
    ).toThrow();
  });
});
