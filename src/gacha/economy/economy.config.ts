import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BOX_PRICE,
  CATEGORY_WEIGHTS,
  QUALITY_WEIGHTS,
  CARD_FLOOR,
} from './economy.rules';

export const ECONOMY_DEFAULTS = {
  key_price: 1500,
  box_prices: BOX_PRICE,
  box_category_weights: CATEGORY_WEIGHTS,
  box_quality_weights: QUALITY_WEIGHTS,
  foil_weights: { NORMAL: 85, HOLO: 12, GOLD: 3 },
  card_floors: CARD_FLOOR,
  skin_floors: {
    COMMON: 2000,
    RARE: 4000,
    EPIC: 7000,
    LEGENDARY: 12000,
  } as Record<string, number>,
  daily_bonus: 350,
  listing_active_limit: 20,
  buy_order_active_limit: 5,
  listing_ttl_ms: 604800000,
  market_tax_pct: 0.1,
  official_price_markup: 1.35,
  spins_per_hour: 5,
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

export function economyConfig(snapshot: Prisma.JsonValue): EconomyConfig {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new ConflictException('Versão econômica inválida.');
  }
  // Older versions inherit documented launch defaults for newly added keys.
  const merged = { ...ECONOMY_DEFAULTS, ...snapshot };
  const validate = (value: unknown, expected: unknown): boolean => {
    if (typeof expected === 'number')
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const actual = value as Record<string, unknown>;
    return Object.entries(expected as Record<string, unknown>).every(
      ([key, child]) => key in actual && validate(actual[key], child),
    );
  };
  for (const key of Object.keys(ECONOMY_DEFAULTS)) {
    if (
      !validate(
        merged[key as keyof EconomyConfig],
        ECONOMY_DEFAULTS[key as keyof EconomyConfig],
      )
    ) {
      throw new ConflictException(`Configuração econômica inválida: ${key}.`);
    }
  }
  if (
    merged.market_tax_pct > 1 ||
    merged.official_price_markup <= 0 ||
    merged.listing_ttl_ms <= 0
  )
    throw new ConflictException('Limites econômicos inválidos.');
  const weights = [
    merged.foil_weights,
    merged.tier_weights,
    ...Object.values(merged.box_category_weights),
    ...Object.values(merged.box_quality_weights),
  ];
  if (
    weights.some(
      (row) => Object.values(row).reduce((sum, value) => sum + value, 0) <= 0,
    )
  )
    throw new ConflictException('Pesos econômicos vazios.');
  return merged;
}
