export const GACHA_ROLLS_PER_DAY = 1;
export const GACHA_PITY_DAYS = 30;
export const GACHA_POOL_PER_ANIME = 8;

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

export const GACHA_TIER_WEIGHTS: Record<GachaTier, number> = {
  COMUM: 55,
  INCOMUM: 25,
  RARA: 12,
  EPICA: 5.5,
  LENDARIA: 2,
  MITICA: 0.4,
  GALACTICA: 0.1,
};

export const GACHA_PITY_WEIGHTS: Record<GachaTier, number> = {
  COMUM: 0,
  INCOMUM: 0,
  RARA: 0,
  EPICA: 70,
  LENDARIA: 20,
  MITICA: 8,
  GALACTICA: 2,
};

export const GACHA_FOILS = ['NORMAL', 'HOLO', 'GOLD'] as const;
export type GachaFoil = (typeof GACHA_FOILS)[number];

export const GACHA_FOIL_WEIGHTS: Record<GachaFoil, number> = {
  NORMAL: 85,
  HOLO: 12,
  GOLD: 3,
};

export const GACHA_BASE_VALUE: Record<GachaTier, number> = {
  COMUM: 10,
  INCOMUM: 25,
  RARA: 50,
  EPICA: 200,
  LENDARIA: 1000,
  MITICA: 5000,
  GALACTICA: 25000,
};

export const GACHA_FOIL_MULT: Record<GachaFoil, number> = {
  NORMAL: 1,
  HOLO: 3,
  GOLD: 10,
};

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
): number {
  const base =
    GACHA_BASE_VALUE[tier] * conditionMult(condition) * GACHA_FOIL_MULT[foil];
  const lowEditionBonus = edition <= 10 ? (11 - edition) * 100 : 0;
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
