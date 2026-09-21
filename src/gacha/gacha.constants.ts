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

export const GACHA_FOILS = ['NORMAL', 'HOLO', 'GOLD'] as const;
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
  const base = baseValues[tier] * conditionMult(condition) * foilMult[foil];
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
