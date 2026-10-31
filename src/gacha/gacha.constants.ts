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

export function conditionLabel(condition: number): string {
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
