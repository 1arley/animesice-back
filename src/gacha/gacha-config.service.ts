import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export type GachaTier =
  'COMUM' | 'INCOMUM' | 'RARA' | 'EPICA' | 'LENDARIA' | 'MITICA' | 'GALACTICA';

export type GachaFoil = 'NORMAL' | 'HOLO' | 'GOLD';

export const GACHA_TIERS: readonly GachaTier[] = [
  'COMUM',
  'INCOMUM',
  'RARA',
  'EPICA',
  'LENDARIA',
  'MITICA',
  'GALACTICA',
];

export const GACHA_FOILS: readonly GachaFoil[] = ['NORMAL', 'HOLO', 'GOLD'];

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

  async update(
    key: string,
    value: Prisma.InputJsonValue,
    authorId: string,
    reason: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gachaConfig.update({
        where: { key },
        data: { value },
      });
      const [config, latest] = await Promise.all([
        tx.gachaConfig.findMany(),
        tx.gachaEconomyVersion.aggregate({ _max: { version: true } }),
      ]);
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

  get dailyBonus(): number {
    return this.num('daily_bonus');
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
}
