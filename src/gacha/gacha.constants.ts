export const GACHA_TIERS = [
  'COMUM',
  'INCOMUM',
  'RARA',
  'EPICA',
  'LENDARIA',
  'MITICA',
  'GALACTICA',
] as const;
export type GachaTier = (typeof GACHA_TIERS)[number];

export const GACHA_FOILS = ['NORMAL', 'HOLO', 'GOLD', 'INK', 'PRISM'] as const;
export type GachaFoil = (typeof GACHA_FOILS)[number];

export const BURN_CONDITION_FRAGMENTS = {
  POOR: 1,
  PLAYED: 2,
  EX: 3,
  NM: 4,
  MINT: 5,
} as const;

export const BURN_RARITY_FRAGMENT_BONUS: Record<GachaTier, number> = {
  COMUM: 0,
  INCOMUM: 1,
  RARA: 2,
  EPICA: 3,
  LENDARIA: 4,
  MITICA: 5,
  GALACTICA: 6,
};

export const MAX_BURN_FRAGMENTS = 9;
export const GEM_FRAGMENT_RECIPE = 20;
export type CardCondition = keyof typeof BURN_CONDITION_FRAGMENTS;

export const FOIL_INVENTORY_FIELDS = {
  HOLO: { shards: 'holoShards', gems: 'holoGems' },
  GOLD: { shards: 'goldShards', gems: 'goldGems' },
  INK: { shards: 'inkShards', gems: 'inkGems' },
  PRISM: { shards: 'prismShards', gems: 'prismGems' },
} as const;

export type SpecialGachaFoil = keyof typeof FOIL_INVENTORY_FIELDS;
export const SPECIAL_GACHA_FOILS = Object.keys(
  FOIL_INVENTORY_FIELDS,
) as SpecialGachaFoil[];

export function isSpecialGachaFoil(foil: string): foil is SpecialGachaFoil {
  return Object.hasOwn(FOIL_INVENTORY_FIELDS, foil);
}

/**
 * Fragmentos recuperados ao extrair o foil de uma carta (metade do custo
 * GEM_FRAGMENT_RECIPE = 20 para impedir ciclo lucrativo craft -> apply -> extract).
 */
export const DEFAULT_FOIL_EXTRACT_FRAGMENTS = 10;

export function burnFragments(condition: number, rarity: string, foil: string) {
  if (foil === 'NORMAL') return null;
  if (!Object.hasOwn(FOIL_INVENTORY_FIELDS, foil)) {
    throw new Error(`Foil inválido em carta: ${foil}`);
  }
  const base = BURN_CONDITION_FRAGMENTS[conditionLabel(condition)];
  const bonus = BURN_RARITY_FRAGMENT_BONUS[rarity as GachaTier];
  if (bonus === undefined)
    throw new Error(`Raridade inválida em carta: ${rarity}`);
  return {
    foil: foil as Exclude<GachaFoil, 'NORMAL'>,
    quantity: Math.min(MAX_BURN_FRAGMENTS, base + bonus),
  };
}

export function conditionLabel(condition: number): CardCondition {
  if (condition <= 0.07) return 'MINT';
  if (condition <= 0.15) return 'NM';
  if (condition <= 0.38) return 'EX';
  if (condition <= 0.55) return 'PLAYED';
  return 'POOR';
}

export function conditionMult(condition: number): number {
  if (condition <= 0.07) return 3;
  if (condition <= 0.15) return 2;
  if (condition <= 0.38) return 1.5;
  if (condition <= 0.55) return 1.2;
  return 1;
}

export function cardValue(
  tier: GachaTier,
  condition: number,
  foil: GachaFoil,
  edition: number,
  baseValues: Record<GachaTier, number>,
  foilMult: Record<GachaFoil, number>,
): number {
  // `foil` vem de coluna String no banco, entao o tipo GachaFoil e uma promessa
  // que o dado persistido pode quebrar (foil de um rollout antigo, por ex). Sem o
  // guard, foil desconhecido -> undefined -> NaN -> escrita Int no Prisma estoura
  // 500 no adminUpdateCard/adminUpdateUserCard. Mult 1 degrada o valor pro base em
  // vez de derrubar a request.
  const base =
    baseValues[tier] * conditionMult(condition) * (foilMult[foil] ?? 1);
  const lowEditionBonus = edition <= 10 ? (base * (11 - edition)) / 10 : 0;
  return Math.round(base + lowEditionBonus);
}

export function pickWeighted<T extends string>(
  weights: Record<T, number>,
  rand = Math.random(),
): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  let cursor = rand * total;
  for (const [key, weight] of entries) {
    cursor -= weight;
    if (cursor < 0) return key;
  }
  const fallback = entries[entries.length - 1];
  if (!fallback) throw new Error('pickWeighted: pesos vazios.');
  return fallback[0];
}

export function isEpicTier(tier: string): boolean {
  return GACHA_TIERS.indexOf(tier as GachaTier) >= GACHA_TIERS.indexOf('EPICA');
}

/**
 * Fragmento bônus no giro (decisão fragmentos-20261030): chance editável no
 * painel admin, com este padrão nos previews. O fragmento independe de
 * raridade. Pesos dentro do bônus:
 * Titanita 50% · Magnetita (DRACONICA) 30% · Titanita Sombria 10% ·
 * Magnetita Sombria (SOMBRIA_DRACONICA) 10%. Os rótulos Dracônica* são
 * exibidos como "Magnetita*" no front.
 */
export const DEFAULT_SPIN_SHARD_CHANCE = 7.5;
export const DEFAULT_AMPULHETA_DROP_CHANCE = 0.5;
export const DEFAULT_AMPULHETA_ENABLED = true;
export const DEFAULT_ROULETTE_ENABLED = true;
export const DEFAULT_ROULETTE_SPIN_DROP_CHANCE = 4.5;

export const SPIN_SHARD_WEIGHTS = {
  TITANITA: 0.5,
  TITANITA_SOMBRIA: 0.1,
  DRACONICA: 0.3,
  SOMBRIA_DRACONICA: 0.1,
} as const;

export type SpinShardKind = keyof typeof SPIN_SHARD_WEIGHTS;

/** Coluna de fragmentos no GachaInventory correspondente a cada bônus. */
export const SPIN_SHARD_FIELD = {
  TITANITA: 'titanitaShards',
  TITANITA_SOMBRIA: 'titanitaSombriaShards',
  DRACONICA: 'draconicaShards',
  SOMBRIA_DRACONICA: 'sombriaDraconicaShards',
} as const satisfies Record<SpinShardKind, string>;

export const ROULETTE_PRIZE_CATEGORIES = [
  'CRYSTAL',
  'KEY',
  'SPIN_RESET',
  'COMMON_BOX',
  'RARE_BOX',
  'PREMIUM_BOX',
  'KEY_RARE_BOX',
  'KEY_PREMIUM_BOX',
  'ITEM',
  'FOIL_SHARD',
  'FOIL_GEM',
  'ESSENCE',
  'CARD',
  'SKIN',
  'CARD_BACK',
] as const;

export type RoulettePrizeCategory = (typeof ROULETTE_PRIZE_CATEGORIES)[number];

export interface RoulettePrizeConfig {
  id: string;
  label: string;
  category: RoulettePrizeCategory;
  itemId?: string | null;
  quantity: number;
  weight: number;
  enabled: boolean;
}

export const DEFAULT_ROULETTE_PRIZES: RoulettePrizeConfig[] = [
  {
    id: 'crystals_120',
    label: '120 Cristais',
    category: 'CRYSTAL',
    itemId: null,
    quantity: 120,
    weight: 18,
    enabled: true,
  },
  {
    id: 'crystals_350',
    label: '350 Cristais',
    category: 'CRYSTAL',
    itemId: null,
    quantity: 350,
    weight: 8,
    enabled: true,
  },
  {
    id: 'key_1',
    label: 'Chave de Baú',
    category: 'KEY',
    itemId: 'KEY',
    quantity: 1,
    weight: 10,
    enabled: true,
  },
  {
    id: 'spin_reset_1',
    label: 'Reset de Giros',
    category: 'SPIN_RESET',
    itemId: 'SPIN_RESET',
    quantity: 1,
    weight: 8,
    enabled: true,
  },
  {
    id: 'common_box_1',
    label: 'Baú Comum',
    category: 'COMMON_BOX',
    itemId: 'COMMON_BOX',
    quantity: 1,
    weight: 7,
    enabled: true,
  },
  {
    id: 'rare_box_1',
    label: 'Baú Raro',
    category: 'RARE_BOX',
    itemId: 'RARE_BOX',
    quantity: 1,
    weight: 3.5,
    enabled: true,
  },
  {
    id: 'premium_box_1',
    label: 'Baú Premium',
    category: 'PREMIUM_BOX',
    itemId: 'PREMIUM_BOX',
    quantity: 1,
    weight: 1,
    enabled: true,
  },
  {
    id: 'key_rare_box',
    label: 'Chave + Baú Raro',
    category: 'KEY_RARE_BOX',
    itemId: null,
    quantity: 1,
    weight: 1.5,
    enabled: true,
  },
  {
    id: 'key_premium_box',
    label: 'Chave + Baú Premium',
    category: 'KEY_PREMIUM_BOX',
    itemId: null,
    quantity: 1,
    weight: 0.4,
    enabled: true,
  },
  {
    id: 'shard_titanita',
    label: '2x Frag. de Titanita',
    category: 'ITEM',
    itemId: 'TITANITA_SHARD',
    quantity: 2,
    weight: 8,
    enabled: true,
  },
  {
    id: 'shard_magnetita',
    label: '2x Frag. de Magnetita',
    category: 'ITEM',
    itemId: 'DRACONICA_SHARD',
    quantity: 2,
    weight: 8,
    enabled: true,
  },
  {
    id: 'shard_titanita_sombria',
    label: 'Frag. Titanita Sombria',
    category: 'ITEM',
    itemId: 'TITANITA_SOMBRIA_SHARD',
    quantity: 1,
    weight: 4.5,
    enabled: true,
  },
  {
    id: 'shard_magnetita_sombria',
    label: 'Frag. Magnetita Sombria',
    category: 'ITEM',
    itemId: 'SOMBRIA_DRACONICA_SHARD',
    quantity: 1,
    weight: 4.5,
    enabled: true,
  },
  {
    id: 'item_titanita',
    label: 'Titanita',
    category: 'ITEM',
    itemId: 'TITANITA',
    quantity: 1,
    weight: 1.5,
    enabled: true,
  },
  {
    id: 'item_magnetita',
    label: 'Magnetita',
    category: 'ITEM',
    itemId: 'DRACONICA',
    quantity: 1,
    weight: 1.5,
    enabled: true,
  },
  {
    id: 'item_titanita_sombria',
    label: 'Titanita Sombria',
    category: 'ITEM',
    itemId: 'TITANITA_SOMBRIA',
    quantity: 1,
    weight: 0.7,
    enabled: true,
  },
  {
    id: 'item_magnetita_sombria',
    label: 'Magnetita Sombria',
    category: 'ITEM',
    itemId: 'SOMBRIA_DRACONICA',
    quantity: 1,
    weight: 0.7,
    enabled: true,
  },
  {
    id: 'item_protecao',
    label: 'Proteção de Reroll',
    category: 'ITEM',
    itemId: 'PROTECAO',
    quantity: 1,
    weight: 1.5,
    enabled: true,
  },
  {
    id: 'item_extrator_foil',
    label: 'Extrator de Foil',
    category: 'ITEM',
    itemId: 'EXTRATOR_FOIL',
    quantity: 1,
    weight: 0.6,
    enabled: true,
  },
  {
    id: 'item_ampulheta',
    label: 'Ampulheta do Éter',
    category: 'ITEM',
    itemId: 'AMPULHETA_ETER',
    quantity: 1,
    weight: 0.8,
    enabled: true,
  },
  {
    id: 'foil_shards',
    label: '2x Fragmentos de Foil',
    category: 'FOIL_SHARD',
    itemId: null,
    quantity: 2,
    weight: 3.5,
    enabled: true,
  },
  {
    id: 'foil_gem',
    label: 'Gema de Foil',
    category: 'FOIL_GEM',
    itemId: null,
    quantity: 1,
    weight: 0.5,
    enabled: true,
  },
  {
    id: 'card_pull',
    label: 'Carta do Gacha',
    category: 'CARD',
    itemId: null,
    quantity: 1,
    weight: 3.5,
    enabled: true,
  },
  {
    id: 'skin_pull',
    label: 'Skin de Personagem',
    category: 'SKIN',
    itemId: null,
    quantity: 1,
    weight: 0.8,
    enabled: true,
  },
  {
    id: 'card_back',
    label: 'Capa de Carta',
    category: 'CARD_BACK',
    itemId: null,
    quantity: 1,
    weight: 0.8,
    enabled: true,
  },
  {
    id: 'code_essence',
    label: 'Essência Exclusiva de Código',
    category: 'ESSENCE',
    itemId: 'ESSENCIA_CODIGO',
    quantity: 1,
    weight: 1.2,
    enabled: true,
  },
];
