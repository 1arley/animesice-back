import { ESSENCE_KINDS, type EssenceKind } from './item-catalog';
import { ConflictException } from '@nestjs/common';
import {
  BOX_PRICE,
  CATEGORY_WEIGHTS,
  QUALITY_WEIGHTS,
  CARD_FLOOR,
  ITEM_KINDS,
  isDirectConsumableKind,
  type ItemKind,
  type BoxTier,
} from './economy.rules';
import {
  DEFAULT_FOIL_EXTRACT_FRAGMENTS,
  GACHA_FOILS,
  GEM_FRAGMENT_RECIPE,
  SPECIAL_GACHA_FOILS,
  isSpecialGachaFoil,
} from '@/gacha/gacha.constants';
import type {
  GachaFoil,
  GachaTier,
  SpecialGachaFoil,
} from '@/gacha/gacha.constants';

export type FoilExtractFragmentsConfig = { default: number } & Partial<
  Record<SpecialGachaFoil, number>
>;

const MAX_DATABASE_INT = 2_147_483_647;

export const ECONOMY_DEFAULTS = {
  essence_shop_price: Object.fromEntries(
    ESSENCE_KINDS.map((kind) => [kind, 0]),
  ) as Record<EssenceKind, number>,
  essence_shop_enabled: Object.fromEntries(
    ESSENCE_KINDS.map((kind) => [kind, false]),
  ) as Record<EssenceKind, boolean>,
  essence_kind_weights: Object.fromEntries(
    (['COMMON', 'RARE', 'PREMIUM'] as const).map((tier) => [
      tier,
      Object.fromEntries(ESSENCE_KINDS.map((kind) => [kind, 0])),
    ]),
  ) as Record<BoxTier, Record<EssenceKind, number>>,
  key_price: 1500,
  box_prices: BOX_PRICE,
  box_category_weights: CATEGORY_WEIGHTS,
  box_quality_weights: QUALITY_WEIGHTS,
  foil_weights: { NORMAL: 79, HOLO: 12, GOLD: 3, INK: 3, PRISM: 3 },
  base_value: {
    COMUM: 10,
    INCOMUM: 25,
    RARA: 60,
    EPICA: 150,
    LENDARIA: 400,
    MITICA: 800,
    GALACTICA: 1600,
  } as Record<GachaTier, number>,
  foil_mult: { NORMAL: 1, HOLO: 3, GOLD: 10, INK: 10, PRISM: 5 } as Record<
    GachaFoil,
    number
  >,
  card_floors: CARD_FLOOR,
  skin_floors: {
    COMMON: 2000,
    RARE: 4000,
    EPIC: 7000,
    LEGENDARY: 12000,
  } as Record<string, number>,
  daily_bonus: 350,
  watch_crystals_per_10min: 30,
  watch_crystals_daily_cap: 900,
  watch_crystals_complete_bonus: 50,
  listing_active_limit: 20,
  buy_order_active_limit: 5,
  listing_ttl_ms: 604800000,
  market_tax_pct: 0.1,
  official_price_markup: 1.35,
  spins_per_hour: 5,
  reroll_cost_pct: 0.15,
  // Q14 (decision record laya-loot-items-20261023): fonte de fragmentos/itens
  // nas caixas. Snapshot legado sem essas chaves herda os defaults de lançamento
  // explicitamente (mergeWeightRows + spread), afetando somente operações novas.
  item_kind_weights: {
    COMMON: {
      TITANITA: 60,
      TITANITA_SOMBRIA: 30,
      DRACONICA: 0,
      SOMBRIA_DRACONICA: 0,
      PROTECAO: 10,
      EXTRATOR_FOIL: 0,
    },
    RARE: {
      TITANITA: 45,
      TITANITA_SOMBRIA: 35,
      DRACONICA: 0,
      SOMBRIA_DRACONICA: 0,
      PROTECAO: 20,
      EXTRATOR_FOIL: 0,
    },
    PREMIUM: {
      TITANITA: 10,
      TITANITA_SOMBRIA: 20,
      DRACONICA: 30,
      SOMBRIA_DRACONICA: 35,
      PROTECAO: 5,
      EXTRATOR_FOIL: 0,
    },
  },
  item_qty_per_quality: { BASIC: 1, RARE: 2, EPIC: 3, LEGENDARY: 5 },
  item_recipes: {
    TITANITA: 3,
    TITANITA_SOMBRIA: 5,
    DRACONICA: 5,
    SOMBRIA_DRACONICA: 7,
  },
  item_eligibility: {
    TITANITA: {
      foils: ['NORMAL'],
      sourceConditions: ['POOR', 'PLAYED', 'EX'],
      maxCondition: 'NM',
    },
    TITANITA_SOMBRIA: {
      foils: ['HOLO', 'GOLD', 'INK', 'PRISM'],
      sourceConditions: ['POOR', 'PLAYED', 'EX'],
      maxCondition: 'NM',
    },
    DRACONICA: {
      foils: ['NORMAL'],
      sourceConditions: ['NM'],
      maxCondition: 'MINT',
    },
    SOMBRIA_DRACONICA: {
      foils: ['HOLO', 'GOLD', 'INK', 'PRISM'],
      sourceConditions: ['NM'],
      maxCondition: 'MINT',
    },
  },
  item_shop_price: {
    TITANITA: 500,
    TITANITA_SOMBRIA: 1500,
    DRACONICA: 6500,
    SOMBRIA_DRACONICA: 0,
    PROTECAO: 400,
    EXTRATOR_FOIL: 2000,
  },
  // Separate availability from price so the purchase experiment is reversible.
  item_shop_enabled: {
    TITANITA: true,
    TITANITA_SOMBRIA: true,
    DRACONICA: true,
    SOMBRIA_DRACONICA: true,
    PROTECAO: true,
    EXTRATOR_FOIL: true,
  },
  item_convert_value: {
    TITANITA: 250,
    TITANITA_SOMBRIA: 750,
    DRACONICA: 3250,
    SOMBRIA_DRACONICA: 4500,
    PROTECAO: 0,
    EXTRATOR_FOIL: 0,
  },
  foil_extract_fragments: {
    default: DEFAULT_FOIL_EXTRACT_FRAGMENTS,
    ...Object.fromEntries(
      SPECIAL_GACHA_FOILS.map((foil) => [foil, DEFAULT_FOIL_EXTRACT_FRAGMENTS]),
    ),
  } as FoilExtractFragmentsConfig,
  item_condition_anchor: { PLAYED: 0.465, EX: 0.265, NM: 0.11, MINT: 0.035 },
  reroll_mint_clamp: 0.071,
  reroll_protection_mint_block: true,
  tier_weights: {
    COMUM: 55,
    INCOMUM: 25,
    RARA: 12,
    EPICA: 5.5,
    LENDARIA: 2,
    MITICA: 0.4,
    GALACTICA: 0.1,
  },
};

export type EconomyConfig = typeof ECONOMY_DEFAULTS;

export function hasItemLootSource(config: EconomyConfig, kind: ItemKind) {
  return (Object.keys(config.box_category_weights) as BoxTier[]).some(
    (tier) =>
      config.box_category_weights[tier].ITEM > 0 &&
      config.item_kind_weights[tier][kind] > 0 &&
      Object.entries(config.box_quality_weights[tier]).some(
        ([quality, weight]) =>
          weight > 0 &&
          (isDirectConsumableKind(kind) ||
            (config.item_qty_per_quality[
              quality as keyof typeof config.item_qty_per_quality
            ] ?? 0) > 0),
      ),
  );
}

export function foilExtractFragmentsFor(
  config: EconomyConfig,
  foil: SpecialGachaFoil,
): number {
  return (
    config.foil_extract_fragments[foil] ?? config.foil_extract_fragments.default
  );
}

function mergeFoilExtractFragments(saved: unknown): FoilExtractFragmentsConfig {
  if (saved === undefined) {
    return { ...ECONOMY_DEFAULTS.foil_extract_fragments };
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    return saved as FoilExtractFragmentsConfig;
  }
  const record = saved as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  if ('default' in record) {
    next.default = record.default;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'default') continue;
    if (isSpecialGachaFoil(key)) {
      next[key] = value;
    }
  }
  return next as FoilExtractFragmentsConfig;
}

export function assertItemShopSources(snapshot: unknown) {
  const config = economyConfig(snapshot);
  for (const kind of ITEM_KINDS) {
    if (!config.item_shop_enabled[kind] && !hasItemLootSource(config, kind)) {
      throw new ConflictException(
        `Não é possível desativar a loja de ${kind}: não há uma fonte ativa em loot boxes.`,
      );
    }
  }
  return config;
}

function mergeWeightRows<T extends Record<string, Record<string, number>>>(
  defaults: T,
  saved: unknown,
): T {
  if (saved === undefined) {
    // Clone: o caller pode sobrescrever (ITEM legado = 0) sem tocar os
    // defaults compartilhados entre chamadas.
    return Object.fromEntries(
      Object.entries(defaults).map(([tier, row]) => [tier, { ...row }]),
    ) as T;
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved))
    return saved as T;
  const savedRows = saved as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(defaults).map(([tier, defaultValues]) => {
      const savedTier = savedRows[tier];
      if (
        tier in savedRows &&
        (!savedTier ||
          typeof savedTier !== 'object' ||
          Array.isArray(savedTier))
      )
        return [tier, savedTier];
      const values =
        savedTier && typeof savedTier === 'object' && !Array.isArray(savedTier)
          ? (savedTier as Record<string, unknown>)
          : {};
      return [
        tier,
        Object.fromEntries(
          Object.entries(defaultValues).map(([name, value]) => [
            name,
            name in values ? values[name] : value,
          ]),
        ),
      ];
    }),
  ) as T;
}

function mergeItemEligibility(
  saved: unknown,
): EconomyConfig['item_eligibility'] {
  if (saved === undefined) return ECONOMY_DEFAULTS.item_eligibility;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved))
    return saved as EconomyConfig['item_eligibility'];
  const value = saved as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(ECONOMY_DEFAULTS.item_eligibility).map(
      ([kind, defaults]) => {
        if (!(kind in value)) return [kind, defaults];
        const rule = value[kind];
        if (!rule || typeof rule !== 'object' || Array.isArray(rule))
          return [kind, rule];
        const partial = rule as Record<string, unknown>;
        return [
          kind,
          Object.fromEntries(
            Object.entries(defaults).map(([field, fallback]) => [
              field,
              field in partial ? partial[field] : fallback,
            ]),
          ),
        ];
      },
    ),
  ) as EconomyConfig['item_eligibility'];
}

export function economyConfig(snapshot: unknown): EconomyConfig {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new ConflictException('Versão econômica inválida.');
  }
  const input = snapshot as Record<string, unknown>;
  // Older versions inherit documented launch defaults for newly added keys.
  const merged = { ...ECONOMY_DEFAULTS, ...input };
  // Política legado: snapshot publicado antes da seção de itens (sem a chave
  // item_kind_weights) fica 0 no peso ITEM — mesma distribuição histórica.
  // Habilitar itens exige publicar nova versão no admin.
  const legacySnapshot = !('item_kind_weights' in input);
  merged.box_category_weights = mergeWeightRows(
    ECONOMY_DEFAULTS.box_category_weights,
    input.box_category_weights,
  );
  if (legacySnapshot) {
    for (const tier of Object.keys(merged.box_category_weights) as BoxTier[]) {
      merged.box_category_weights[tier] = {
        ...merged.box_category_weights[tier],
        ITEM: 0,
      };
    }
  }
  merged.box_quality_weights = mergeWeightRows(
    ECONOMY_DEFAULTS.box_quality_weights,
    input.box_quality_weights,
  );
  // Peso 0 mantém desativado explicitamente; ausente herda o default do
  // snapshot novo (política de espalhamento de lançamento, como foil_weights).
  merged.item_kind_weights = mergeWeightRows(
    ECONOMY_DEFAULTS.item_kind_weights,
    input.item_kind_weights,
  );
  merged.essence_kind_weights = mergeWeightRows(
    ECONOMY_DEFAULTS.essence_kind_weights,
    input.essence_kind_weights,
  );
  merged.item_eligibility = mergeItemEligibility(input.item_eligibility);
  merged.foil_extract_fragments = mergeFoilExtractFragments(
    input.foil_extract_fragments,
  );
  for (const key of [
    'essence_shop_price',
    'essence_shop_enabled',
    'item_shop_price',
    'item_shop_enabled',
    'item_convert_value',
  ] as const) {
    const saved = input[key];
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      Object.assign(merged, { [key]: { ...ECONOMY_DEFAULTS[key], ...saved } });
    }
  }
  for (const key of ['foil_weights', 'foil_mult'] as const) {
    const saved = input[key];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
    // Snapshot e imutavel: foil que saiu do enum (NEGATIVE) continua la para
    // sempre. Sem o filtro ele ainda entra em pickWeighted e cunha carta que a
    // UI nao conhece. Renomear em migration nao cobre versao antiga do snapshot.
    const savedObject = Object.fromEntries(
      Object.entries(saved as Record<string, number>).filter(([foil]) =>
        (GACHA_FOILS as readonly string[]).includes(foil),
      ),
    );
    merged[key] = { ...ECONOMY_DEFAULTS[key], ...savedObject };
    if (key === 'foil_weights') {
      // Snapshot legado nao tem os foils novos: cada peso ausente sai do
      // NORMAL, senao os novos nunca saem sorteados.
      const addedWeight = GACHA_FOILS.filter(
        (foil) => !(foil in savedObject),
      ).reduce((sum, foil) => sum + ECONOMY_DEFAULTS.foil_weights[foil], 0);
      merged.foil_weights.NORMAL = Math.max(
        0,
        (savedObject.NORMAL ?? ECONOMY_DEFAULTS.foil_weights.NORMAL) -
          addedWeight,
      );
    }
  }
  const validate = (value: unknown, expected: unknown): boolean => {
    if (typeof expected === 'number')
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (typeof expected === 'boolean') return typeof value === 'boolean';
    if (typeof expected === 'string') return typeof value === 'string';
    if (Array.isArray(expected))
      return (
        Array.isArray(value) &&
        value.every((item) => typeof item === typeof expected[0])
      );
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const actual = value as Record<string, unknown>;
    return Object.entries(expected as Record<string, unknown>).every(
      ([key, child]) => key in actual && validate(actual[key], child),
    );
  };
  for (const key of Object.keys(ECONOMY_DEFAULTS)) {
    if (key === 'foil_extract_fragments') continue;
    if (
      !validate(
        merged[key as keyof EconomyConfig],
        ECONOMY_DEFAULTS[key as keyof EconomyConfig],
      )
    ) {
      throw new ConflictException(`Configuração econômica inválida: ${key}.`);
    }
  }
  const extractConfig = merged.foil_extract_fragments;
  if (
    !extractConfig ||
    typeof extractConfig !== 'object' ||
    Array.isArray(extractConfig)
  ) {
    throw new ConflictException(
      'Configuração econômica inválida: foil_extract_fragments.',
    );
  }
  if (
    !('default' in extractConfig) ||
    Object.values(extractConfig).some(
      (qty) =>
        typeof qty !== 'number' ||
        !Number.isSafeInteger(qty) ||
        qty < 1 ||
        qty >= GEM_FRAGMENT_RECIPE,
    )
  ) {
    throw new ConflictException('Configuração de extração de foil inválida.');
  }
  if (
    merged.market_tax_pct > 1 ||
    merged.official_price_markup <= 0 ||
    merged.listing_ttl_ms <= 0 ||
    merged.reroll_cost_pct <= 0 ||
    merged.reroll_cost_pct > 1
  )
    throw new ConflictException('Limites econômicos inválidos.');
  const weights = [
    merged.foil_weights,
    merged.tier_weights,
    ...Object.values(merged.box_category_weights),
    ...Object.values(merged.box_quality_weights),
    ...Object.values(merged.item_kind_weights),
  ];
  if (
    weights.some(
      (row) => Object.values(row).reduce((sum, value) => sum + value, 0) <= 0,
    )
  )
    throw new ConflictException('Pesos econômicos vazios.');
  if (
    merged.box_quality_weights.PREMIUM.EPIC +
      merged.box_quality_weights.PREMIUM.LEGENDARY <=
    0
  )
    throw new ConflictException('Cartas Premium precisam de qualidade épica+.');
  // Q7: clamp precisa ficar fora da faixa MINT (<= 0.07), senão o reroll
  // cruza para MINT.
  if (!(merged.reroll_mint_clamp > 0.07 && merged.reroll_mint_clamp <= 1))
    throw new ConflictException('Trava MINT de reroll inválida.');
  for (const kind of Object.keys(merged.item_eligibility) as Array<
    keyof typeof merged.item_eligibility
  >) {
    const rule = merged.item_eligibility[kind];
    const labels = ['POOR', 'PLAYED', 'EX', 'NM', 'MINT'];
    const maxRank = labels.indexOf(rule.maxCondition);
    if (
      rule.foils.length === 0 ||
      rule.sourceConditions.length === 0 ||
      rule.foils.some(
        (foil) => !(GACHA_FOILS as readonly string[]).includes(foil),
      ) ||
      rule.sourceConditions.some(
        (condition) =>
          !['MINT', 'NM', 'EX', 'PLAYED', 'POOR'].includes(condition),
      ) ||
      new Set(rule.foils).size !== rule.foils.length ||
      new Set(rule.sourceConditions).size !== rule.sourceConditions.length ||
      maxRank < 0 ||
      rule.sourceConditions.some((condition) => {
        const nextRank = labels.indexOf(condition) + 1;
        return nextRank <= 0 || nextRank > maxRank;
      })
    )
      throw new ConflictException('Elegibilidade de pedra inválida.');
  }
  for (const quantity of Object.values(merged.item_qty_per_quality)) {
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_DATABASE_INT
    )
      throw new ConflictException('Quantidade de fragmentos inválida.');
  }
  for (const recipe of Object.values(merged.item_recipes)) {
    if (
      !Number.isSafeInteger(recipe) ||
      recipe < 1 ||
      recipe > Math.floor(MAX_DATABASE_INT / 100)
    )
      throw new ConflictException('Receitas de itens inválidas.');
  }
  const anchors = merged.item_condition_anchor;
  if (
    !(anchors.PLAYED > 0.38 && anchors.PLAYED <= 0.55) ||
    !(anchors.EX > 0.15 && anchors.EX <= 0.38) ||
    !(anchors.NM > 0.07 && anchors.NM <= 0.15) ||
    !(anchors.MINT >= 0 && anchors.MINT <= 0.07)
  )
    throw new ConflictException('Âncoras de condition inválidas.');
  for (const kind of ITEM_KINDS) {
    const shop = merged.item_shop_price[kind];
    const convert = merged.item_convert_value[kind];
    if (
      !Number.isSafeInteger(shop) ||
      !Number.isSafeInteger(convert) ||
      shop < 0 ||
      shop > Math.floor(MAX_DATABASE_INT / 100) ||
      convert < 0 ||
      convert > Math.floor(MAX_DATABASE_INT / 100)
    )
      throw new ConflictException('Preços de itens precisam ser inteiros.');
    if (kind === 'PROTECAO' && convert !== 0)
      throw new ConflictException('Proteção não pode ser convertida.');
    if (isDirectConsumableKind(kind) && convert !== 0)
      throw new ConflictException('Item consumível não pode ser convertido.');
    if (shop > 0 && shop <= convert)
      throw new ConflictException(
        'Preço de loja deve exceder a conversão do fragmento.',
      );
  }
  for (const kind of ESSENCE_KINDS) {
    const price = merged.essence_shop_price[kind];
    if (
      !Number.isSafeInteger(price) ||
      price < 0 ||
      price > Math.floor(MAX_DATABASE_INT / 100)
    )
      throw new ConflictException('Preço de Essência inválido.');
    if (merged.essence_shop_enabled[kind] && price === 0)
      throw new ConflictException(
        'Essência habilitada precisa de preço positivo.',
      );
  }
  for (const tier of ['COMMON', 'RARE', 'PREMIUM'] as const) {
    if (
      merged.box_category_weights[tier].ESSENCE > 0 &&
      Object.values(merged.essence_kind_weights[tier]).every(
        (weight) => weight === 0,
      )
    ) {
      throw new ConflictException(
        `Baú ${tier} com Essências precisa de pesos de raridade.`,
      );
    }
  }
  return merged;
}
