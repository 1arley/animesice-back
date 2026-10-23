export const BOX_TIERS = ['COMMON', 'RARE', 'PREMIUM'] as const;
export type BoxTier = (typeof BOX_TIERS)[number];

export const PRIZE_CATEGORIES = [
  'CRYSTAL',
  'SPIN_RESET',
  'CARD',
  'SKIN',
  'KEY',
  'CARD_BACK',
  'RARE_BOX',
  'KEY_RARE_BOX',
  'KEY_PREMIUM_BOX',
  'ITEM',
] as const;
export type PrizeCategory = (typeof PRIZE_CATEGORIES)[number];

export const PRIZE_QUALITIES = ['BASIC', 'RARE', 'EPIC', 'LEGENDARY'] as const;
export type PrizeQuality = (typeof PRIZE_QUALITIES)[number];

export const BOX_PRICE: Record<BoxTier, number> = {
  COMMON: 500,
  RARE: 1_500,
  PREMIUM: 5_000,
};

export const KEY_PRICE = 1_500;

export const BOX_TOTAL_COST: Record<BoxTier, number> = {
  COMMON: BOX_PRICE.COMMON + KEY_PRICE,
  RARE: BOX_PRICE.RARE + KEY_PRICE,
  PREMIUM: BOX_PRICE.PREMIUM + KEY_PRICE,
};

export const CATEGORY_WEIGHTS: Record<
  BoxTier,
  Record<PrizeCategory, number>
> = {
  COMMON: {
    CRYSTAL: 35,
    SPIN_RESET: 15,
    CARD: 8,
    SKIN: 25,
    KEY: 0,
    CARD_BACK: 2,
    RARE_BOX: 10,
    KEY_RARE_BOX: 4,
    KEY_PREMIUM_BOX: 1,
    ITEM: 4,
  },
  RARE: {
    CRYSTAL: 9,
    SPIN_RESET: 20,
    CARD: 25,
    SKIN: 30,
    KEY: 0,
    CARD_BACK: 12,
    RARE_BOX: 0,
    KEY_RARE_BOX: 0,
    KEY_PREMIUM_BOX: 4,
    ITEM: 6,
  },
  PREMIUM: {
    CRYSTAL: 5,
    SPIN_RESET: 25,
    CARD: 35,
    SKIN: 25,
    KEY: 0,
    CARD_BACK: 10,
    RARE_BOX: 0,
    KEY_RARE_BOX: 0,
    KEY_PREMIUM_BOX: 0,
    ITEM: 15,
  },
};

export const QUALITY_WEIGHTS: Record<BoxTier, Record<PrizeQuality, number>> = {
  COMMON: { BASIC: 65, RARE: 25, EPIC: 8, LEGENDARY: 2 },
  RARE: { BASIC: 40, RARE: 35, EPIC: 20, LEGENDARY: 5 },
  PREMIUM: { BASIC: 20, RARE: 35, EPIC: 30, LEGENDARY: 15 },
};

export function prizeQuality(
  tier: BoxTier,
  category: PrizeCategory,
  weights: Record<BoxTier, Record<PrizeQuality, number>>,
  random = Math.random(),
): PrizeQuality {
  const selectedWeights =
    tier === 'PREMIUM' && category === 'CARD'
      ? {
          BASIC: 0,
          RARE: 0,
          EPIC: weights[tier].EPIC,
          LEGENDARY: weights[tier].LEGENDARY,
        }
      : weights[tier];
  return weightedPick(selectedWeights, random);
}

export const ITEM_KINDS = [
  'TITANITA',
  'TITANITA_SOMBRIA',
  'DRACONICA',
  'SOMBRIA_DRACONICA',
  'PROTECAO',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const CARD_FLOOR: Record<string, number> = {
  COMUM: 500,
  INCOMUM: 750,
  RARA: 1_250,
  EPICA: 2_500,
  LENDARIA: 5_000,
  MITICA: 9_000,
  GALACTICA: 15_000,
};

export const BURN_PAYOUT: Record<string, number> = {
  COMUM: 100,
  INCOMUM: 150,
  RARA: 250,
  EPICA: 500,
  LENDARIA: 1_000,
  MITICA: 1_800,
  GALACTICA: 3_000,
};

const CRYSTAL_PACKAGES = {
  BRL_490: { cents: 490, crystals: 950 },
  BRL_990: { cents: 990, crystals: 2_000 },
  BRL_1990: { cents: 1_990, crystals: 4_200 },
  BRL_2990: { cents: 2_990, crystals: 6_500 },
  BRL_4990: { cents: 4_990, crystals: 11_250 },
} as const;

export function crystalPackage(packageId: string): {
  cents: number;
  crystals: number;
} {
  const value = CRYSTAL_PACKAGES[packageId as keyof typeof CRYSTAL_PACKAGES];
  if (!value) throw new Error('Pacote inexistente.');
  return value;
}

const saoPauloDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function dayKey(date = new Date()): string {
  return saoPauloDay.format(date);
}

export function dateFromDayKey(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

/// Início do dia de America/Sao_Paulo em UTC. O fuso é -3 fixo (horário de
/// verão abolido em 2019): meia-noite local = 03:00Z.
export function dayStart(date = new Date()): Date {
  return new Date(`${dayKey(date)}T03:00:00.000Z`);
}

export function inactiveEventIds(
  value: unknown,
  field: 'cardIds' | 'skinIds' | 'cardBackKeys',
  now = new Date(),
): string[] {
  if (!value || typeof value !== 'object') return [];
  const event = value as Record<string, unknown>;
  const start = typeof event.startDay === 'number' ? event.startDay : 1;
  const day = Number(dayKey(now).slice(-2));
  if (day >= start && day < start + 7) return [];
  const ids = event[field];
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string')
    : [];
}

export function weightedPick<T extends string>(
  weights: Record<T, number>,
  random = Math.random(),
): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = Math.min(Math.max(random, 0), 0.999999999999) * total;
  for (const [key, weight] of entries) {
    cursor -= weight;
    if (cursor < 0) return key;
  }
  return entries[entries.length - 1]![0];
}

export function prizeAmount(
  category: PrizeCategory,
  tier: BoxTier,
  quality: PrizeQuality,
  random = Math.random(),
): number {
  if (category === 'CRYSTAL') return crystalPrizeAmount(tier, random);
  const qualityIndex = PRIZE_QUALITIES.indexOf(quality);
  if (category === 'KEY') return [1, 1, 2, 3][qualityIndex]!;
  return 1;
}

export function crystalPrizeAmount(tier: BoxTier, random = Math.random()) {
  const bounded = Math.min(Math.max(random, 0), 0.999999999999);
  if (tier === 'COMMON') return 200 + Math.floor(bounded * 14) * 100;
  const [min, max] = tier === 'RARE' ? [800, 2_500] : [2_500, 10_000];
  return min + Math.floor(bounded * (max - min + 1));
}

export function officialPrice(floor: number, median: number | null): number {
  return Math.max(floor, median === null ? 0 : Math.ceil(median * 1.35));
}
