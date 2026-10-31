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
 * Fragmento bônus no giro (decisão fragmentos-20261030): 5% dos previews vêm
 * com um fragmento junto, independente de raridade. Pesos dentro do bônus:
 * Titanita 50% · Magnetita (DRACONICA) 30% · Titanita Sombria 10% ·
 * Magnetita Sombria (SOMBRIA_DRACONICA) 10%. Os rótulos Dracônica* são
 * exibidos como "Magnetita*" no front.
 */
export const SPIN_SHARD_CHANCE = 0.05;

export const SPIN_SHARD_WEIGHTS = {
  TITANITA: 0.5,
  TITANITA_SOMBRIA: 0.1,
  DRACONICA: 0.3,
  SOMBRIA_DRACONICA: 0.1,
} as const;

export type SpinShardKind = keyof typeof SPIN_SHARD_WEIGHTS;

/** Coluna de fragmentos no GachaInventory correspondente a cada bônus. */
export const SPIN_SHARD_FIELD: Record<SpinShardKind, string> = {
  TITANITA: 'titanitaShards',
  TITANITA_SOMBRIA: 'titanitaSombriaShards',
  DRACONICA: 'draconicaShards',
  SOMBRIA_DRACONICA: 'sombriaDraconicaShards',
};
