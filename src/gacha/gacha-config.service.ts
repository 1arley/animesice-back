import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { assertItemShopSources } from '@/gacha/economy/economy.config';

function hasExplicitTimezoneIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function activeGachaEventEndsAt(
  value: Prisma.JsonValue | null | undefined,
  now = Date.now(),
): string | null {
  if (
    value === null ||
    value === undefined ||
    Array.isArray(value) ||
    typeof value !== 'object'
  )
    return null;
  const endsAt = value.endsAt;
  return hasExplicitTimezoneIsoTimestamp(endsAt) && Date.parse(endsAt) > now
    ? endsAt
    : null;
}

function assertMarketAgeExemption(value: Prisma.InputJsonValue): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('market_age_exemption deve ser um objeto.');
  }
  const endsAt = (value as Record<string, unknown>).endsAt;
  if (!hasExplicitTimezoneIsoTimestamp(endsAt)) {
    throw new BadRequestException(
      'market_age_exemption.endsAt deve ser data ISO 8601 com fuso horário explícito.',
    );
  }
}

export type GachaTier =
  'COMUM' | 'INCOMUM' | 'RARA' | 'EPICA' | 'LENDARIA' | 'MITICA' | 'GALACTICA';

export type GachaFoil = 'NORMAL' | 'HOLO' | 'GOLD' | 'INK' | 'PRISM';

/** Valor bruto da chave `claim_event` no GachaConfig (campos todos opcionais). */
export interface ClaimEventValue {
  active?: unknown;
  name?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  tiers?: unknown;
  spinsPerHour?: unknown;
}

/** Estado efetivo do evento: flag ativa E dentro da janela startsAt–endsAt. */
export interface ClaimEventState {
  active: boolean;
  name: string;
  tiers: GachaTier[];
}

export const GACHA_TIERS: readonly GachaTier[] = [
  'COMUM',
  'INCOMUM',
  'RARA',
  'EPICA',
  'LENDARIA',
  'MITICA',
  'GALACTICA',
];

export const GACHA_FOILS: readonly GachaFoil[] = [
  'NORMAL',
  'HOLO',
  'GOLD',
  'INK',
  'PRISM',
];

@Injectable()
export class GachaConfigService implements OnModuleInit {
  private readonly logger = new Logger(GachaConfigService.name);
  private cache = new Map<string, unknown>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh();
  }

  async refresh() {
    const rows = await this.prisma.gachaConfig.findMany();
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.key, row.value);
    }
    this.logger.log(`GachaConfig carregado: ${rows.length} chaves`);
  }

  list() {
    return this.prisma.gachaConfig.findMany({ orderBy: { group: 'asc' } });
  }

  async rollAnimation() {
    const config = await this.prisma.gachaConfig.findUnique({
      where: { key: 'anim_roll' },
      select: { value: true },
    });
    return config?.value ?? {};
  }

  async update(
    key: string,
    value: Prisma.InputJsonValue,
    authorId: string,
    reason: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.gachaConfig.findMany();
      const candidate = {
        ...Object.fromEntries(current.map((item) => [item.key, item.value])),
        [key]: value,
      };
      assertItemShopSources(candidate);
      if (key === 'claim_event') assertClaimEvent(value);
      if (key === 'market_age_exemption') assertMarketAgeExemption(value);

      const row = await tx.gachaConfig.upsert({
        where: { key },
        create: { key, value, label: key, group: 'gacha' },
        update: { value },
      });
      const [config, latest] = await Promise.all([
        tx.gachaConfig.findMany(),
        tx.gachaEconomyVersion.aggregate({ _max: { version: true } }),
      ]);
      const snapshot = Object.fromEntries(
        config.map((item) => [item.key, item.value]),
      );
      assertItemShopSources(snapshot);
      await tx.gachaEconomyVersion.create({
        data: {
          version: (latest._max.version ?? 0) + 1,
          snapshot: Object.fromEntries(
            config.map((item) => [item.key, item.value]),
          ),
          authorId,
          reason,
        },
      });
      return row;
    });
    await this.refresh();
    return updated;
  }

  // ── helpers ──────────────────────────────────────────────

  private num(key: string): number {
    return Number(this.cache.get(key));
  }

  private obj<T extends string, V>(key: string): Record<T, V> {
    return this.cache.get(key) as Record<T, V>;
  }

  // ── economy basics ───────────────────────────────────────

  get rollsPerDay(): number {
    return this.num('rolls_per_day');
  }

  get pityDays(): number {
    return this.num('pity_days');
  }

  get poolPerAnime(): number {
    return this.num('pool_per_anime');
  }

  get spinsPerHour(): number {
    return this.num('spins_per_hour');
  }

  get rerollCostPct(): number {
    return this.num('reroll_cost_pct');
  }

  get applyCostPct(): number {
    return this.num('apply_cost_pct');
  }

  get dailyBonus(): number {
    return this.num('daily_bonus');
  }

  get pullPostsEnabled(): boolean {
    return this.cache.get('pull_posts_enabled') !== false;
  }

  // ── bypass ───────────────────────────────────────────────

  get bypassPriceCents(): number {
    return this.num('bypass_price_cents');
  }

  get bypassTtlMs(): number {
    return this.num('bypass_ttl_ms');
  }

  // ── market ───────────────────────────────────────────────

  get listingActiveLimit(): number {
    return this.num('listing_active_limit');
  }

  get marketTaxPct(): number {
    return this.num('market_tax_pct');
  }

  get listingTtlMs(): number {
    return this.num('listing_ttl_ms');
  }

  // ── trade ────────────────────────────────────────────────

  get tradeTtlMs(): number {
    return this.num('trade_ttl_ms');
  }

  get tradeActiveLimit(): number {
    return this.num('trade_active_limit');
  }

  get tradeCounterTtlMs(): number {
    return this.num('trade_counter_ttl_ms');
  }

  // ── skin spin ────────────────────────────────────────────

  get skinSpinCooldownMs(): number {
    return this.num('skin_spin_cooldown_ms');
  }

  get skinSpinPrice(): number {
    return this.num('skin_spin_price');
  }

  // ── featured ─────────────────────────────────────────────

  get featuredAccrualLimitMs(): number {
    return this.num('featured_accrual_limit_ms');
  }

  get featuredProductiveMsPerDay(): number {
    return this.num('featured_productive_ms_per_day');
  }

  // ── rates ────────────────────────────────────────────────

  get tierWeights(): Record<GachaTier, number> {
    return this.obj('tier_weights');
  }

  get pityWeights(): Record<GachaTier, number> {
    return this.obj('pity_weights');
  }

  get foilWeights(): Record<GachaFoil, number> {
    return this.obj('foil_weights');
  }

  // ── values ───────────────────────────────────────────────

  get baseValue(): Record<GachaTier, number> {
    return this.obj('base_value');
  }

  get foilMult(): Record<GachaFoil, number> {
    return this.obj('foil_mult');
  }

  get cardFloors(): Record<GachaTier, number> {
    return this.obj('card_floors');
  }

  get burnPayout(): Record<GachaTier, number> {
    return this.obj('burn_payout');
  }

  get collectionRewards(): Record<'25' | '50' | '100', number> {
    return this.obj('collection_rewards');
  }

  get claimLockHours(): Record<GachaTier, number> {
    return this.obj('claim_lock_hours');
  }

  claimLockMs(tier: GachaTier): number {
    return this.claimLockHours[tier] * 60 * 60 * 1000;
  }

  // ── claim event ──────────────────────────────────────────

  get claimEvent(): ClaimEventValue {
    return this.cache.get('claim_event') ?? {};
  }

  /**
   * Estado efetivo do evento de resgate: `active` só vale dentro da janela
   * startsAt–endsAt (com qualquer lado aberto). Parse defensivo — valor
   * malformado nunca derruba o gacha, só mantém o evento desligado.
   */
  claimEventState(now = new Date()): ClaimEventState {
    const raw = this.claimEvent;
    const name = typeof raw.name === 'string' ? raw.name : '';
    const start = parseDateOrNull(raw.startsAt);
    const end = parseDateOrNull(raw.endsAt);
    const tiers = Array.isArray(raw.tiers)
      ? raw.tiers.filter((tier): tier is GachaTier =>
          (GACHA_TIERS as readonly string[]).includes(tier as GachaTier),
        )
      : [];
    const inWindow =
      (start === null || now >= start) && (end === null || now < end);
    return { active: raw.active === true && inWindow, name, tiers };
  }

  /** Giros/hora vigentes: override do evento quando ativo e definido. */
  effectiveSpinsPerHour(now = new Date()): number {
    if (!this.claimEventState(now).active) return this.spinsPerHour;
    const override = Number(this.claimEvent.spinsPerHour);
    return Number.isSafeInteger(override) && override > 0
      ? override
      : this.spinsPerHour;
  }
}

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Rejeita shape inválido no PATCH — melhor erro no admin do que evento mudo. */
export function assertClaimEvent(value: Prisma.InputJsonValue): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('claim_event deve ser um objeto.');
  }
  const v = value as Record<string, unknown>;
  if (v.active !== undefined && typeof v.active !== 'boolean') {
    throw new BadRequestException('active deve ser boolean.');
  }
  if (v.name !== undefined && typeof v.name !== 'string') {
    throw new BadRequestException('name deve ser string.');
  }
  for (const field of ['startsAt', 'endsAt'] as const) {
    const raw = v[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string' || Number.isNaN(new Date(raw).getTime())) {
      throw new BadRequestException(
        `${field} deve ser data ISO 8601 (ex.: 2026-11-20T03:00:00Z).`,
      );
    }
  }
  if (v.tiers !== undefined) {
    if (
      !Array.isArray(v.tiers) ||
      (v.tiers as unknown[]).some(
        (tier) =>
          !(GACHA_TIERS as readonly string[]).includes(tier as GachaTier),
      )
    ) {
      throw new BadRequestException(
        `tiers deve ser lista de raridades válidas: ${GACHA_TIERS.join(', ')}.`,
      );
    }
  }
  if (
    v.spinsPerHour !== undefined &&
    v.spinsPerHour !== null &&
    (!Number.isSafeInteger(v.spinsPerHour) || (v.spinsPerHour as number) < 1)
  ) {
    throw new BadRequestException(
      'spinsPerHour deve ser inteiro >= 1 (ou null para usar o global).',
    );
  }
}
