import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CardSource,
  CardStatus,
  CrystalEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  GACHA_BYPASS_PRICE_CENTS,
  claimLockMs,
  GACHA_COSMETICS,
  GACHA_FOILS,
  GACHA_FOIL_WEIGHTS,
  GACHA_LISTING_ACTIVE_LIMIT,
  GACHA_MARKET_TAX_PCT,
  GACHA_PITY_DAYS,
  GACHA_PITY_WEIGHTS,
  GACHA_REROLL_COST_PCT,
  GACHA_SPINS_PER_HOUR,
  GACHA_TIER_WEIGHTS,
  GACHA_TIERS,
  GachaFoil,
  GachaTier,
  cardValue,
  conditionLabel,
  isEpicTier,
  pickWeighted,
} from '@/gacha/gacha.constants';
import { createHash, randomInt } from 'node:crypto';
import { WishlistService } from '@/gacha/wishlist.service';
import {
  UpsertCardWishlistDto,
  UpsertSetWishlistDto,
} from '@/gacha/dto/gacha.dto';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TRADE_TTL_MS = 48 * HOUR_MS;
const TRADE_ACTIVE_LIMIT = 3;
const EPIC_RARITIES = ['EPICA', 'LENDARIA', 'MITICA', 'GALACTICA'];
const SKIN_SPIN_COOLDOWN_MS = 12 * HOUR_MS;
const SKIN_SPIN_PRICE = 1_000;
const FEATURED_ACCRUAL_LIMIT_MS = 7 * DAY_MS;
const FEATURED_PRODUCTIVE_MS_PER_DAY = 10 * HOUR_MS;
const FEATURED_REWARD_DENOMINATOR = BigInt(2 * HOUR_MS * 10_000);

export function gachaPilotBucket(userId: string): number {
  return createHash('sha256').update(userId).digest().readUInt32BE(0) % 100;
}

/** Tempo remunerado: primeiras 10h de cada janela de 24h ancorada no destaque. */
export function featuredProductiveMs(
  startedAt: Date,
  from: Date,
  to: Date,
): number {
  if (to <= from) return 0;
  let cursor = Math.max(from.getTime(), startedAt.getTime());
  const end = to.getTime();
  let total = 0;
  while (cursor < end) {
    const offset = cursor - startedAt.getTime();
    const dayStart = startedAt.getTime() + Math.floor(offset / DAY_MS) * DAY_MS;
    const nextDay = dayStart + DAY_MS;
    const paidEnd = dayStart + FEATURED_PRODUCTIVE_MS_PER_DAY;
    total += Math.max(0, Math.min(end, paidEnd) - cursor);
    cursor = Math.min(end, nextDay);
  }
  return total;
}

const PULL_SELECT = {
  id: true,
  condition: true,
  foil: true,
  edition: true,
  value: true,
  valueOverride: true,
  obtainedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      userName: true,
      avatar: true,
      gachaCosmetics: true,
      gachaCardBack: true,
    },
  },
  originalUser: {
    select: { id: true, name: true, userName: true, avatar: true },
  },
  skin: {
    select: { id: true, name: true, imageUrl: true },
  },
  card: {
    select: {
      id: true,
      name: true,
      image: true,
      imageHidden: true,
      rarity: true,
      favourites: true,
      animeId: true,
      animeTitle: true,
      anime: {
        select: {
          id: true,
          slug: true,
          title: true,
          coverImage: true,
          malId: true,
        },
      },
    },
  },
} satisfies Prisma.UserCardSelect;

type Pull = Prisma.UserCardGetPayload<{ select: typeof PULL_SELECT }>;

const LISTING_SELECT = {
  id: true,
  userId: true,
  userCardId: true,
  price: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  user: {
    select: { id: true, name: true, userName: true, avatar: true },
  },
  userCard: { select: PULL_SELECT },
} satisfies Prisma.GachaListingSelect;

const SPIN_SELECT = {
  id: true,
  hour: true,
  slot: true,
  condition: true,
  foil: true,
  value: true,
  claimedAt: true,
  expiresAt: true,
  createdAt: true,
  card: {
    select: {
      id: true,
      name: true,
      image: true,
      imageHidden: true,
      rarity: true,
      favourites: true,
      animeId: true,
      animeTitle: true,
      anime: {
        select: {
          id: true,
          slug: true,
          title: true,
          coverImage: true,
          malId: true,
        },
      },
    },
  },
} satisfies Prisma.GachaSpinSelect;

const TRADE_SELECT = {
  id: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  completedAt: true,
  offeredUserId: true,
  requestedUserId: true,
  offeredUserCardId: true,
  requestedUserCardId: true,
  offeredUserCard: { select: PULL_SELECT },
  requestedUserCard: { select: PULL_SELECT },
  cards: {
    orderBy: [{ side: 'asc' }, { position: 'asc' }],
    select: { userCardId: true, side: true, position: true, snapshot: true },
  },
} satisfies Prisma.GachaTradeSelect;

type TradeRow = Prisma.GachaTradeGetPayload<{ select: typeof TRADE_SELECT }>;

const presentCard = <
  T extends { name: string; image: string | null; imageHidden: boolean },
>(
  card: T,
) => (card.imageHidden ? { ...card, name: '???', image: null } : card);

const presentPull = (pull: Pull) => {
  const card = presentCard(pull.card);
  return {
    ...pull,
    conditionLabel: conditionLabel(pull.condition),
    card: {
      ...card,
      image: pull.card.imageHidden ? null : (pull.skin?.imageUrl ?? card.image),
    },
  };
};

const fmtTrade = (t: TradeRow) => ({
  ...t,
  offeredUserCards: t.cards
    ?.filter((c) => c.side === 'OFFERED')
    .map((c) => c.snapshot) ?? [t.offeredUserCard],
  requestedUserCards: t.cards
    ?.filter((c) => c.side === 'REQUESTED')
    .map((c) => c.snapshot) ?? [t.requestedUserCard],
  offeredUserCard: {
    ...presentPull(t.offeredUserCard),
  },
  requestedUserCard: {
    ...presentPull(t.requestedUserCard),
  },
});

@Injectable()
export class GachaService {
  private readonly logger = new Logger(GachaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly wishlistService?: WishlistService,
  ) {}

  private async pilotConfig() {
    const rows = await this.prisma.siteSetting.findMany({
      where: {
        key: {
          in: [
            'GACHA_ENGAGEMENT_PILOT_PERCENT',
            'GACHA_ENGAGEMENT_PILOT_STARTED_AT',
          ],
        },
      },
    });
    const settings = new Map(rows.map((row) => [row.key, row.value]));
    const rawPercent = Number(
      settings.get('GACHA_ENGAGEMENT_PILOT_PERCENT') ??
        process.env.GACHA_ENGAGEMENT_PILOT_PERCENT ??
        10,
    );
    const percent = Number.isFinite(rawPercent)
      ? Math.min(100, Math.max(0, Math.trunc(rawPercent)))
      : 10;
    const rawStartedAt = settings.get('GACHA_ENGAGEMENT_PILOT_STARTED_AT');
    const startedAt = rawStartedAt ? new Date(rawStartedAt) : new Date();
    return {
      percent,
      startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
    };
  }

  private async pilotEnabled(userId: string) {
    const config = await this.pilotConfig();
    return gachaPilotBucket(userId) < config.percent;
  }

  async engagementPilotStatus(userId: string) {
    const config = await this.pilotConfig();
    return {
      enabled: gachaPilotBucket(userId) < config.percent,
      percent: config.percent,
    };
  }

  async adminUpdateEngagementPilot(percent: number) {
    const existing = await this.prisma.siteSetting.findUnique({
      where: { key: 'GACHA_ENGAGEMENT_PILOT_STARTED_AT' },
      select: { value: true },
    });
    const startedAt = existing?.value ?? new Date().toISOString();
    await this.prisma.$transaction([
      this.prisma.siteSetting.upsert({
        where: { key: 'GACHA_ENGAGEMENT_PILOT_PERCENT' },
        create: {
          key: 'GACHA_ENGAGEMENT_PILOT_PERCENT',
          value: String(percent),
        },
        update: { value: String(percent) },
      }),
      this.prisma.siteSetting.upsert({
        where: { key: 'GACHA_ENGAGEMENT_PILOT_STARTED_AT' },
        create: { key: 'GACHA_ENGAGEMENT_PILOT_STARTED_AT', value: startedAt },
        update: {},
      }),
    ]);
    return this.adminEngagementPilot();
  }

  async adminEngagementPilot() {
    const config = await this.pilotConfig();
    // ponytail: varredura de IDs no painel admin; migrar o bucket para coluna
    // persistida se a tabela User chegar a centenas de milhares de linhas.
    const users = await this.prisma.user.findMany({ select: { id: true } });
    const cohort = users
      .map(({ id }) => id)
      .filter((id) => gachaPilotBucket(id) < config.percent);
    const [issued, spent, earners, spins, discoveries] = await Promise.all([
      this.prisma.crystalEvent.aggregate({
        where: {
          userId: { in: cohort },
          createdAt: { gte: config.startedAt },
          type: { in: ['FEATURED', 'COLLECTION'] },
        },
        _sum: { delta: true },
      }),
      this.prisma.crystalEvent.aggregate({
        where: {
          userId: { in: cohort },
          createdAt: { gte: config.startedAt },
          type: { in: ['SPEND', 'TAX'] },
          delta: { lt: 0 },
        },
        _sum: { delta: true },
      }),
      this.prisma.crystalEvent.findMany({
        where: {
          userId: { in: cohort },
          createdAt: { gte: config.startedAt },
          type: { in: ['FEATURED', 'COLLECTION'] },
        },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.gachaSpin.findMany({
        where: { userId: { in: cohort }, createdAt: { gte: config.startedAt } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.gachaCardDiscovery.findMany({
        where: {
          userId: { in: cohort },
          discoveredAt: { gte: config.startedAt },
        },
        select: { userId: true, cardId: true, discoveredAt: true },
      }),
    ]);
    const meaningful = new Set([
      ...spins.map(({ userId }) => userId),
      ...discoveries.map(({ userId }) => userId),
    ]);
    const rewardOnly = earners.filter(({ userId }) => !meaningful.has(userId));
    const cardOwners = new Map<string, Set<string>>();
    for (const row of discoveries) {
      const owners = cardOwners.get(row.cardId) ?? new Set<string>();
      owners.add(row.userId);
      cardOwners.set(row.cardId, owners);
    }
    const sharedCards = [...cardOwners.values()].filter(
      (owners) => owners.size >= 3,
    ).length;
    const emitted = issued._sum.delta ?? 0;
    const sinks = Math.abs(spent._sum.delta ?? 0);
    const rewardOnlyRate = earners.length
      ? rewardOnly.length / earners.length
      : 0;
    return {
      config: {
        percent: config.percent,
        startedAt: config.startedAt.toISOString(),
      },
      cohort: { assigned: cohort.length, totalUsers: users.length },
      economy: {
        emitted,
        sinks,
        ratio: sinks === 0 ? null : emitted / sinks,
        pause: emitted > sinks * 1.2,
      },
      behavior: {
        earners: earners.length,
        meaningfulUsers: meaningful.size,
        rewardOnlyUsers: rewardOnly.length,
        rewardOnlyRate,
        sharedCards,
        pause: rewardOnlyRate > 0.3 || sharedCards > cohort.length * 0.1,
      },
      satisfaction: { measured: false },
    };
  }

  wishlist(
    userId: string,
    viewerId: string | null,
    options: Parameters<WishlistService['list']>[2] = {},
  ) {
    if (!this.wishlistService) throw new Error('WishlistService indisponível.');
    return this.wishlistService.list(userId, viewerId, options);
  }

  upsertCardWishlist(
    userId: string,
    cardId: string,
    dto: UpsertCardWishlistDto,
  ) {
    if (!this.wishlistService) throw new Error('WishlistService indisponível.');
    return this.wishlistService.upsertCard(userId, cardId, dto);
  }

  deleteCardWishlist(userId: string, cardId: string) {
    if (!this.wishlistService) throw new Error('WishlistService indisponível.');
    return this.wishlistService.deleteCard(userId, cardId);
  }

  upsertSetWishlist(
    userId: string,
    animeId: string,
    dto: UpsertSetWishlistDto,
  ) {
    if (!this.wishlistService) throw new Error('WishlistService indisponível.');
    return this.wishlistService.upsertSet(userId, animeId, dto);
  }

  deleteSetWishlist(userId: string, animeId: string) {
    if (!this.wishlistService) throw new Error('WishlistService indisponível.');
    return this.wishlistService.deleteSet(userId, animeId);
  }

  setWishlistPrivacy(userId: string, isPublic: boolean) {
    if (!this.wishlistService) throw new Error('WishlistService indisponível.');
    return this.wishlistService.setPrivacy(userId, isPublic);
  }

  interestedWishlistUsers(
    cardId: string,
    animeId: string | null,
    copy: { condition: number; foil: string; edition: number },
  ) {
    if (!this.wishlistService) throw new Error('WishlistService indisponível.');
    return this.wishlistService.interestedUsers(cardId, animeId, copy);
  }

  // ponytail: dia em UTC; migrar p/ TZ do usuário se houver reclamação BR.
  private dayStartUtc(now = new Date()): Date {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }

  private hourStartUtc(now = new Date()): Date {
    const start = new Date(now);
    start.setUTCMinutes(0, 0, 0);
    return start;
  }

  private async settleFeatured(userId: string, now = new Date()) {
    if (!(await this.pilotEnabled(userId))) return 0;
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            featuredStartedAt: true,
            featuredSettledAt: true,
            featuredRemainder: true,
            featuredUserCard: {
              select: { id: true, cardId: true, value: true },
            },
          },
        });
        const card = user?.featuredUserCard;
        const startedAt = user?.featuredStartedAt;
        const settledAt = user?.featuredSettledAt;
        if (!card || !startedAt || !settledAt) return 0;

        const paidUntil = new Date(
          Math.min(
            now.getTime(),
            settledAt.getTime() + FEATURED_ACCRUAL_LIMIT_MS,
          ),
        );
        const productiveMs = featuredProductiveMs(
          startedAt,
          settledAt,
          paidUntil,
        );
        const medal = await tx.gachaCollectionProgress.findFirst({
          where: {
            userId,
            reward100At: { not: null },
            collection: { members: { some: { cardId: card.cardId } } },
          },
          select: { collectionId: true },
        });
        const rateBps = medal ? 105n : 100n;
        const numerator =
          user.featuredRemainder +
          BigInt(card.value) * BigInt(productiveMs) * rateBps;
        const amount = Number(numerator / FEATURED_REWARD_DENOMINATOR);
        const remainder = numerator % FEATURED_REWARD_DENOMINATOR;
        if (amount > 0) {
          await this.changeCrystals(
            tx,
            userId,
            amount,
            'FEATURED',
            card.id,
            'Rendimento da carta em destaque',
          );
        }
        await tx.user.update({
          where: { id: userId },
          data: { featuredSettledAt: now, featuredRemainder: remainder },
        });
        return amount;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async collectionProgress(userId: string) {
    if (!(await this.pilotEnabled(userId))) return [];
    return this.prisma.$transaction(
      async (tx) => {
        const owned = await tx.userCard.findMany({
          where: { userId, status: 'ACTIVE' },
          distinct: ['cardId'],
          select: { cardId: true },
        });
        await tx.gachaCardDiscovery.createMany({
          data: owned.map(({ cardId }) => ({ userId, cardId })),
          skipDuplicates: true,
        });
        const [collections, discoveries, user, saved] = await Promise.all([
          tx.gachaCollection.findMany({
            where: { published: true },
            include: { members: { select: { cardId: true } } },
            orderBy: { name: 'asc' },
          }),
          tx.gachaCardDiscovery.findMany({
            where: { userId },
            select: { cardId: true },
          }),
          tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { favoriteCollectionId: true, pinnedCollectionIds: true },
          }),
          tx.gachaCollectionProgress.findMany({ where: { userId } }),
        ]);
        const discovered = new Set(discoveries.map(({ cardId }) => cardId));
        const savedByKey = new Map(
          saved.map((row) => [`${row.collectionId}:${row.version}`, row]),
        );
        const result = [];
        for (const collection of collections) {
          const total = collection.members.length;
          const found = collection.members.reduce(
            (count, member) => count + Number(discovered.has(member.cardId)),
            0,
          );
          const percent = total === 0 ? 0 : Math.floor((found * 100) / total);
          const previous = savedByKey.get(
            `${collection.id}:${collection.version}`,
          );
          const now = new Date();
          const reward25At =
            previous?.reward25At ?? (percent >= 25 ? now : null);
          const reward50At =
            previous?.reward50At ?? (percent >= 50 ? now : null);
          const reward100At =
            previous?.reward100At ?? (percent >= 100 ? now : null);
          const rewards: Array<readonly [number, number]> = [];
          if (!previous?.reward25At && reward25At) rewards.push([25, 50]);
          if (!previous?.reward50At && reward50At) rewards.push([50, 100]);
          if (!previous?.reward100At && reward100At) rewards.push([100, 200]);
          await tx.gachaCollectionProgress.upsert({
            where: {
              userId_collectionId_version: {
                userId,
                collectionId: collection.id,
                version: collection.version,
              },
            },
            create: {
              userId,
              collectionId: collection.id,
              version: collection.version,
              reward25At,
              reward50At,
              reward100At,
            },
            update: { reward25At, reward50At, reward100At },
          });
          for (const [milestone, crystals] of rewards) {
            await this.changeCrystals(
              tx,
              userId,
              crystals,
              'COLLECTION',
              `${collection.id}:v${collection.version}:${milestone}`,
              `${milestone}% da coleção ${collection.name}`,
            );
          }
          result.push({
            id: collection.id,
            name: collection.name,
            slug: collection.slug,
            version: collection.version,
            total,
            discovered: found,
            percent,
            rewards: { reward25At, reward50At, reward100At },
            favorite:
              user.favoriteCollectionId === collection.id && percent < 100,
            pinned: user.pinnedCollectionIds.includes(collection.id),
          });
        }
        if (
          user.favoriteCollectionId &&
          result.some(
            (collection) =>
              collection.id === user.favoriteCollectionId &&
              collection.percent >= 100,
          )
        ) {
          await tx.user.update({
            where: { id: userId },
            data: { favoriteCollectionId: null },
          });
        }
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateCollectionPreferences(
    userId: string,
    favoriteCollectionId: string | null,
    pinnedCollectionIds: string[],
  ) {
    if (!(await this.pilotEnabled(userId))) {
      throw new ForbiddenException('Recurso ainda indisponível nesta conta.');
    }
    if (pinnedCollectionIds.length > 3) {
      throw new BadRequestException('Escolha no máximo três medalhas.');
    }
    const progress = await this.collectionProgress(userId);
    const byId = new Map(
      progress.map((collection) => [collection.id, collection]),
    );
    if (favoriteCollectionId) {
      const favorite = byId.get(favoriteCollectionId);
      if (!favorite || favorite.percent < 25 || favorite.percent >= 100) {
        throw new BadRequestException('Coleção favorita indisponível.');
      }
    }
    if (pinnedCollectionIds.some((id) => !byId.get(id)?.rewards.reward100At)) {
      throw new BadRequestException(
        'Só medalhas concluídas podem ser fixadas.',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { favoriteCollectionId, pinnedCollectionIds },
    });
    return this.collectionProgress(userId);
  }

  private async pityState(userId: string) {
    const [lastEpic, first] = await this.prisma.$transaction([
      this.prisma.userCard.findFirst({
        where: {
          userId,
          status: 'ACTIVE',
          card: { rarity: { in: EPIC_RARITIES } },
        },
        orderBy: { obtainedAt: 'desc' },
        select: { obtainedAt: true },
      }),
      this.prisma.userCard.findFirst({
        where: { userId, status: 'ACTIVE' },
        orderBy: { obtainedAt: 'asc' },
        select: { obtainedAt: true },
      }),
    ]);
    const since = lastEpic?.obtainedAt ?? first?.obtainedAt ?? null;
    const daysSince = since
      ? Math.floor((Date.now() - since.getTime()) / DAY_MS)
      : 0;
    return {
      pityDaysLeft: since
        ? Math.max(0, GACHA_PITY_DAYS - daysSince)
        : GACHA_PITY_DAYS,
      pityDue: since !== null && daysSince >= GACHA_PITY_DAYS,
    };
  }

  private async claimState(userId: string) {
    const lock = await this.prisma.gachaClaimLock.findUnique({
      where: { userId },
    });
    const locked = lock !== null && lock.lockedUntil.getTime() > Date.now();
    return {
      canClaim: !locked,
      nextClaimAt: locked ? lock.lockedUntil.toISOString() : null,
    };
  }

  async status(userId: string) {
    await this.settleFeatured(userId);
    const hour = this.hourStartUtc();
    const [spinsUsed, claim, pity, first, wallet, points] =
      await this.prisma.$transaction([
        this.prisma.gachaSpin.count({ where: { userId, hour } }),
        this.prisma.gachaClaimLock.findUnique({ where: { userId } }),
        this.prisma.userCard.findFirst({
          where: {
            userId,
            status: 'ACTIVE',
            card: { rarity: { in: EPIC_RARITIES } },
          },
          orderBy: { obtainedAt: 'desc' },
          select: { obtainedAt: true },
        }),
        this.prisma.userCard.findFirst({
          where: { userId, status: 'ACTIVE' },
          orderBy: { obtainedAt: 'asc' },
          select: { obtainedAt: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { crystalBalance: true, gachaCosmetics: true },
        }),
        this.prisma.userCard.aggregate({
          where: { userId, status: 'ACTIVE' },
          _sum: { value: true },
        }),
      ]);

    const since = pity?.obtainedAt ?? first?.obtainedAt ?? null;
    const daysSince = since
      ? Math.floor((Date.now() - since.getTime()) / DAY_MS)
      : 0;
    const pityDaysLeft = since
      ? Math.max(0, GACHA_PITY_DAYS - daysSince)
      : GACHA_PITY_DAYS;

    const locked = claim !== null && claim.lockedUntil.getTime() > Date.now();
    const spinsLeft = Math.max(0, GACHA_SPINS_PER_HOUR - spinsUsed);

    return {
      canRoll: false,
      rollsLeft: 0,
      nextRollAt: null,
      spinsLeft,
      canSpin: spinsLeft > 0,
      nextSpinAt:
        spinsLeft > 0 ? null : new Date(hour.getTime() + HOUR_MS).toISOString(),
      canClaim: !locked,
      nextClaimAt: locked ? claim.lockedUntil.toISOString() : null,
      claimWarning: locked
        ? 'Você já guardou uma carta. Girar continua liberado, mas a próxima só pode ser guardada após o fim do bloqueio.'
        : null,
      bypassPriceCents: locked ? GACHA_BYPASS_PRICE_CENTS : null,
      crystalBalance: wallet?.crystalBalance ?? 0,
      pointsBalance: points._sum.value ?? 0,
      pointsCosmetics: wallet?.gachaCosmetics ?? [],
      pityDaysLeft,
      pityDue: since !== null && daysSince >= GACHA_PITY_DAYS,
    };
  }

  async spins(userId: string) {
    const hour = this.hourStartUtc();
    const spins = await this.prisma.gachaSpin.findMany({
      where: { userId, hour },
      orderBy: { createdAt: 'asc' },
      select: SPIN_SELECT,
    });
    return spins.map((spin) => ({
      ...spin,
      conditionLabel: conditionLabel(spin.condition),
      card: presentCard(spin.card),
    }));
  }

  async spin(userId: string) {
    const hour = this.hourStartUtc();

    const pity = await this.pityState(userId);
    const tier = await this.pickTierWithStock(
      pity.pityDue ? GACHA_PITY_WEIGHTS : GACHA_TIER_WEIGHTS,
    );
    const card = await this.drawFromTier(tier, userId);

    const condition = Math.random();
    const foil = pickWeighted(GACHA_FOIL_WEIGHTS);
    // ponytail: slot único (userId,hour,slot) torna giro concorrente
    // race-safe; P2002 = slot ocupado, tenta o próximo.
    for (let slot = 0; slot < GACHA_SPINS_PER_HOUR; slot++) {
      try {
        const spin = await this.prisma.gachaSpin.create({
          data: {
            userId,
            hour,
            slot,
            cardId: card.id,
            condition,
            foil,
            value: cardValue(tier, condition, foil, 1),
            expiresAt: new Date(hour.getTime() + HOUR_MS),
          },
          select: SPIN_SELECT,
        });
        return {
          ...spin,
          conditionLabel: conditionLabel(spin.condition),
          card: presentCard(spin.card),
          pityDue: pity.pityDue,
        };
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }
    throw new ForbiddenException(
      'Você já usou seus 5 giros desta hora. Volte na próxima hora.',
    );
  }

  async claim(userId: string, spinId: string) {
    let pull: Pull;
    try {
      pull = await this.prisma.$transaction(
        async (tx) => {
          const spin = await tx.gachaSpin.findFirst({
            where: { id: spinId, userId },
            select: SPIN_SELECT,
          });
          if (!spin || spin.claimedAt !== null) {
            throw new NotFoundException('Preview expirada ou já resgatada.');
          }
          if (spin.expiresAt.getTime() <= Date.now()) {
            throw new ForbiddenException('Preview expirou na virada da hora.');
          }

          const lock = await tx.gachaClaimLock.findUnique({
            where: { userId },
          });
          if (lock !== null && lock.lockedUntil.getTime() > Date.now()) {
            throw new ForbiddenException(
              'Você já guardou uma carta recentemente.',
            );
          }
          const counter = await tx.card.update({
            where: { id: spin.card.id },
            data: { editionCounter: { increment: 1 } },
            select: { editionCounter: true },
          });
          const edition = counter.editionCounter;
          const created = await tx.userCard.create({
            data: {
              userId,
              originalUserId: userId,
              cardId: spin.card.id,
              condition: spin.condition,
              foil: spin.foil,
              edition,
              value: cardValue(
                spin.card.rarity as GachaTier,
                spin.condition,
                spin.foil as GachaFoil,
                edition,
              ),
            },
            select: PULL_SELECT,
          });
          await tx.gachaCardDiscovery.createMany({
            data: { userId, cardId: spin.card.id },
            skipDuplicates: true,
          });
          const claimed = await tx.gachaSpin.updateMany({
            where: { id: spin.id, claimedAt: null },
            data: { claimedAt: new Date() },
          });
          if (claimed.count !== 1) {
            throw new NotFoundException('Preview expirada ou já resgatada.');
          }
          const lockMs = claimLockMs(spin.card.rarity as GachaTier);
          await tx.gachaClaimLock.upsert({
            where: { userId },
            create: {
              userId,
              lockedUntil: new Date(Date.now() + lockMs),
            },
            update: { lockedUntil: new Date(Date.now() + lockMs) },
          });
          await this.changeCrystals(
            tx,
            userId,
            Math.floor(created.value / 2),
            'MINT',
            created.id,
            `Carta guardada: ${spin.card.name}`,
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      if (error instanceof NotFoundException) throw error;
      const code =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : typeof error === 'object' && error !== null && 'code' in error
            ? error.code
            : undefined;
      if (code === 'P2002' || code === 'P2034') {
        throw new ForbiddenException(
          'Este preview já está sendo resgatado. Tente novamente.',
        );
      }
      throw error;
    }

    if (isEpicTier(pull.card.rarity)) {
      try {
        await this.publishPullPost(userId, pull);
      } catch (error) {
        this.logger.warn(
          `publishPullPost falhou p/ user ${userId} pull ${pull.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return presentPull(pull);
  }

  // Resgate único de compensação: consome a Notification 'COMPENSATION'
  // não-lerda e cunha um giro garantido (>=EPICA) sem gastar slot da hora nem
  // o cooldown. A updateMany em read=false é a trava de idempotência.
  async claimCompensation(userId: string) {
    const tier = await this.pickTierWithStock(GACHA_PITY_WEIGHTS);
    const card = await this.drawFromTier(tier, userId);
    const condition = Math.random();
    const foil = pickWeighted(GACHA_FOIL_WEIGHTS);

    const pull = await this.prisma.$transaction(
      async (tx) => {
        const pending = await tx.notification.findFirst({
          where: { userId, type: 'COMPENSATION', claimed: false },
          select: { id: true },
        });
        if (!pending) {
          throw new ForbiddenException('Nada a resgatar.');
        }
        const marked = await tx.notification.updateMany({
          where: { id: pending.id, claimed: false },
          data: { claimed: true },
        });
        if (marked.count !== 1) {
          throw new ForbiddenException('Compensação já resgatada.');
        }
        const counter = await tx.card.update({
          where: { id: card.id },
          data: { editionCounter: { increment: 1 } },
          select: { editionCounter: true },
        });
        const edition = counter.editionCounter;
        const created = await tx.userCard.create({
          data: {
            userId,
            originalUserId: userId,
            cardId: card.id,
            condition,
            foil,
            edition,
            value: cardValue(
              card.rarity as GachaTier,
              condition,
              foil,
              edition,
            ),
          },
          select: PULL_SELECT,
        });
        await tx.gachaCardDiscovery.createMany({
          data: { userId, cardId: card.id },
          skipDuplicates: true,
        });
        await this.changeCrystals(
          tx,
          userId,
          Math.floor(created.value / 2),
          'MINT',
          created.id,
          'Compensação',
        );
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (isEpicTier(pull.card.rarity)) {
      try {
        await this.publishPullPost(userId, pull);
      } catch (error) {
        this.logger.warn(
          `publishPullPost falhou p/ compensacao ${userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return presentPull(pull);
  }

  async unlockClaim(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const deleted = await tx.gachaClaimLock.deleteMany({
      where: { userId, lockedUntil: { gt: new Date() } },
    });
    return { unlocked: deleted.count > 0 };
  }

  points(userId: string, page = 1, limit = 20) {
    return this.crystals(userId, page, limit);
  }

  async adjustCrystals(userId: string, delta: number, reason: string) {
    if (
      !Number.isSafeInteger(delta) ||
      delta === 0 ||
      Math.abs(delta) > 2_147_483_647
    ) {
      throw new BadRequestException(
        'delta deve ser um inteiro não-zero de 32 bits.',
      );
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new BadRequestException('Motivo do ajuste é obrigatório.');
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Usuário não encontrado.');
      return this.changeCrystals(
        tx,
        userId,
        delta,
        'ADMIN',
        null,
        reason.trim(),
      );
    });
  }

  async shop(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        crystalBalance: true,
        gachaCosmetics: true,
        gachaCardBack: true,
      },
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    const custom = await this.prisma.gachaCardBack.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        key: true,
        name: true,
        description: true,
        price: true,
        svg: true,
        previewUrl: true,
      },
    });
    return {
      balance: user.crystalBalance,
      activeCardBack: user.gachaCardBack,
      cosmetics: [
        ...GACHA_COSMETICS.map((item) => ({
          ...item,
          owned: user.gachaCosmetics.includes(item.key),
        })),
        ...custom.map((item) => ({
          key: item.key,
          label: item.name,
          description: item.description ?? '',
          price: item.price,
          owned: user.gachaCosmetics.includes(item.key),
          svg: item.svg,
          previewUrl: item.previewUrl,
        })),
      ],
    };
  }

  private async changeCrystals(
    tx: Prisma.TransactionClient,
    userId: string,
    delta: number,
    type: CrystalEventType,
    refId: string | null,
    reason: string,
  ) {
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > 2_147_483_647) {
      throw new BadRequestException('Valor de Crystal inválido.');
    }
    const changed = await tx.user.updateMany({
      where: {
        id: userId,
        crystalBalance: {
          gte: Math.max(0, -delta),
          lte: 2_147_483_647 - Math.max(0, delta),
        },
      },
      data: { crystalBalance: { increment: delta } },
    });
    if (changed.count !== 1) {
      throw new BadRequestException(
        delta < 0 ? 'Crystals insuficientes.' : 'Limite de Crystals excedido.',
      );
    }
    return tx.crystalEvent.create({
      data: { userId, delta, type, refId, reason },
    });
  }

  async reroll(userId: string, userCardId: string) {
    await this.expirePendingTrades();
    const pull = await this.prisma.$transaction(
      async (tx) => {
        const card = await tx.userCard.findFirst({
          where: { id: userCardId, userId, status: 'ACTIVE' },
          select: PULL_SELECT,
        });
        if (!card) {
          throw new NotFoundException('Carta não encontrada.');
        }
        const pendingTrade = await tx.gachaTrade.findFirst({
          where: {
            status: 'PENDING',
            OR: [
              { offeredUserCardId: userCardId },
              { requestedUserCardId: userCardId },
            ],
          },
          select: { id: true },
        });
        if (pendingTrade) {
          throw new BadRequestException('Carta envolvida em troca pendente.');
        }
        const listing = await tx.gachaListing.findFirst({
          where: {
            userCardId,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (listing)
          throw new BadRequestException(
            'Cancele o anúncio antes de rerrolar a carta.',
          );
        const cost = Math.max(
          1,
          card.value + Math.round(card.value * GACHA_REROLL_COST_PCT),
        );
        await this.changeCrystals(
          tx,
          userId,
          -cost,
          'SPEND',
          userCardId,
          `Reroll ${card.card.name} #${card.edition}`,
        );
        const condition = Math.random();
        const foil = pickWeighted(GACHA_FOIL_WEIGHTS);
        return tx.userCard.update({
          where: { id: userCardId },
          data: {
            condition,
            foil,
            value:
              card.valueOverride ??
              cardValue(
                card.card.rarity as GachaTier,
                condition,
                foil,
                card.edition,
              ),
          },
          select: PULL_SELECT,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return presentPull(pull);
  }

  async buyCosmetic(userId: string, key: string) {
    const custom = await this.prisma.gachaCardBack.findFirst({
      where: { key, status: 'PUBLISHED' },
      select: { key: true, name: true, description: true, price: true },
    });
    const item = custom
      ? {
          key: custom.key,
          label: custom.name,
          description: custom.description ?? '',
          price: custom.price,
        }
      : GACHA_COSMETICS.find((cosmetic) => cosmetic.key === key);
    if (!item) {
      throw new BadRequestException('Cosmético inexistente.');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { gachaCosmetics: true },
        });
        if (!user) {
          throw new NotFoundException('Usuário não encontrado.');
        }
        if (user.gachaCosmetics.includes(item.key)) {
          throw new BadRequestException('Você já possui este cosmético.');
        }
        await this.changeCrystals(
          tx,
          userId,
          -item.price,
          'SPEND',
          item.key,
          item.label,
        );
        await tx.user.update({
          where: { id: userId },
          data: { gachaCosmetics: { push: item.key } },
        });
        return { purchased: item.key };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private sanitizeCardBackSvg(svg: string) {
    const clean = svg
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
      .replace(/javascript:/gi, '');
    if (!/^\s*<svg[\s>]/i.test(clean) || clean.length > 500_000)
      throw new BadRequestException('SVG inválido ou pesado demais.');
    return clean;
  }

  adminCardBacks() {
    return this.prisma.gachaCardBack.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }

  adminCreateCardBack(
    data: {
      key: string;
      name: string;
      description?: string;
      svg: string;
      previewUrl?: string;
      price?: number;
      status?: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
    },
    createdById?: string,
  ) {
    return this.prisma.gachaCardBack.create({
      data: {
        ...data,
        svg: this.sanitizeCardBackSvg(data.svg),
        price: data.price ?? 0,
        createdById,
      },
    });
  }

  adminUpdateCardBack(
    id: string,
    data: {
      key?: string;
      name?: string;
      description?: string;
      svg?: string;
      previewUrl?: string;
      price?: number;
      status?: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
    },
  ) {
    return this.prisma.gachaCardBack.update({
      where: { id },
      data: {
        ...data,
        ...(data.svg ? { svg: this.sanitizeCardBackSvg(data.svg) } : {}),
      },
    });
  }

  async cardBackByKey(key: string) {
    const back = await this.prisma.gachaCardBack.findFirst({
      where: { key, status: 'PUBLISHED' },
      select: { key: true, name: true, svg: true, previewUrl: true },
    });
    if (!back) {
      throw new NotFoundException('Capa não encontrada.');
    }
    return back;
  }

  async setCardBack(userId: string, key: string | null) {
    if (key !== null && typeof key !== 'string') {
      throw new BadRequestException('Capa inválida.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { gachaCosmetics: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (key && !key.startsWith('BACK_')) {
      throw new BadRequestException('Cosmético não é capa de carta.');
    }
    if (key && !user.gachaCosmetics.includes(key)) {
      throw new ForbiddenException('Você não possui esta capa.');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { gachaCardBack: key },
      select: { gachaCardBack: true },
    });
  }

  async burn(userId: string, userCardId: string) {
    await this.expirePendingTrades();
    return this.prisma.$transaction(
      async (tx) => {
        const card = await tx.userCard.findFirst({
          where: { id: userCardId, userId, status: 'ACTIVE' },
          select: {
            id: true,
            value: true,
            edition: true,
            card: { select: { name: true } },
          },
        });
        if (!card) throw new NotFoundException('Carta não encontrada.');

        const pendingTrade = await tx.gachaTrade.findFirst({
          where: {
            status: 'PENDING',
            OR: [
              { offeredUserCardId: userCardId },
              { requestedUserCardId: userCardId },
            ],
          },
          select: { id: true },
        });
        if (pendingTrade) {
          throw new BadRequestException('Carta envolvida em troca pendente.');
        }

        const listing = await tx.gachaListing.findFirst({
          where: {
            userCardId,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (listing) {
          throw new BadRequestException(
            'Cancele o anúncio antes de queimar a carta.',
          );
        }

        const featured = await tx.user.findFirst({
          where: { id: userId, featuredUserCardId: userCardId },
          select: { id: true },
        });
        if (featured) {
          throw new BadRequestException(
            'Remova a carta dos destaques antes de queimá-la.',
          );
        }

        const payout = Math.max(1, Math.floor(card.value * 0.4));
        await this.changeCrystals(
          tx,
          userId,
          payout,
          'BURN',
          userCardId,
          `Queima ${card.card.name} #${card.edition}`,
        );
        const burned = await tx.userCard.updateMany({
          where: { id: userCardId, userId, status: 'ACTIVE' },
          data: { status: 'BURNED' },
        });
        if (burned.count !== 1) {
          throw new ConflictException('Carta não está mais disponível.');
        }
        return { burned: userCardId, payout };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createListing(userId: string, userCardId: string, price: number) {
    if (!Number.isSafeInteger(price) || price < 1 || price > 2_147_483_647) {
      throw new BadRequestException('Preço deve ser um inteiro positivo.');
    }
    await this.settleFeatured(userId);
    const listing = await this.prisma.$transaction(
      async (tx) => {
        const card = await tx.userCard.findFirst({
          where: { id: userCardId, userId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!card) {
          throw new NotFoundException('Carta não encontrada.');
        }
        const inTrade = await tx.gachaTrade.findFirst({
          where: {
            status: 'PENDING',
            OR: [
              { offeredUserCardId: userCardId },
              { requestedUserCardId: userCardId },
            ],
          },
          select: { id: true },
        });
        if (inTrade) {
          throw new BadRequestException('Carta envolvida em troca pendente.');
        }
        const now = new Date();
        await tx.gachaListing.updateMany({
          where: { userId, status: 'ACTIVE', expiresAt: { lte: now } },
          data: { status: 'EXPIRED' },
        });
        const active = await tx.gachaListing.count({
          where: { userId, status: 'ACTIVE' },
        });
        if (active >= GACHA_LISTING_ACTIVE_LIMIT) {
          throw new BadRequestException(
            `Limite de ${GACHA_LISTING_ACTIVE_LIMIT} anúncios ativos atingido.`,
          );
        }
        await tx.user.updateMany({
          where: { id: userId, featuredUserCardId: userCardId },
          data: {
            featuredUserCardId: null,
            featuredSettledAt: null,
          },
        });
        try {
          return await tx.gachaListing.create({
            data: {
              userId,
              userCardId,
              price,
              expiresAt: new Date(now.getTime() + TRADE_TTL_MS),
            },
            select: LISTING_SELECT,
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new ConflictException('Esta carta já está anunciada.');
          }
          throw error;
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { ...listing, userCard: presentPull(listing.userCard) };
  }

  async listings(
    page = 1,
    limit = 24,
    sort = 'price',
    rarity?: string,
    foil?: string,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const where: Prisma.GachaListingWhereInput = {
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      user: {
        OR: [
          { privacySettings: null },
          { privacySettings: { is: { showGacha: true } } },
        ],
      },
    };
    const userCardWhere: Prisma.UserCardWhereInput = {};
    if (rarity && (GACHA_TIERS as readonly string[]).includes(rarity)) {
      userCardWhere.card = { rarity };
    }
    if (foil && (GACHA_FOILS as readonly string[]).includes(foil)) {
      userCardWhere.foil = foil;
    }
    if (Object.keys(userCardWhere).length > 0) {
      where.userCard = userCardWhere;
    }
    const orderBy =
      sort === 'newest'
        ? { createdAt: 'desc' as const }
        : sort === 'value'
          ? { userCard: { value: 'desc' as const } }
          : { price: 'asc' as const };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.gachaListing.findMany({
        where,
        orderBy,
        skip: (page - 1) * safeLimit,
        take: safeLimit,
        select: LISTING_SELECT,
      }),
      this.prisma.gachaListing.count({ where }),
    ]);
    const presented = items.map((item) => ({
      ...item,
      userCard: presentPull(item.userCard),
    }));
    const data = this.wishlistService
      ? await Promise.all(
          presented.map(async (item) => ({
            ...item,
            interestedCount: await this.wishlistService!.interestedCount(
              item.userCard.card.id,
              item.userCard.card.animeId,
              item.userCard,
            ),
          })),
        )
      : presented;
    return {
      data,
      meta: {
        page,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  }

  async myListings(userId: string) {
    const now = new Date();
    await this.prisma.gachaListing.updateMany({
      where: { userId, status: 'ACTIVE', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    const listings = await this.prisma.gachaListing.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: LISTING_SELECT,
    });
    return listings.map((listing) => ({
      ...listing,
      userCard: presentPull(listing.userCard),
    }));
  }

  async cancelListing(userId: string, listingId: string) {
    const cancelled = await this.prisma.gachaListing.updateMany({
      where: { id: listingId, userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    if (cancelled.count !== 1) {
      throw new ConflictException('Anúncio não está mais ativo.');
    }
    return { cancelled: true };
  }

  async buyListing(userId: string, listingId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const listing = await tx.gachaListing.findUnique({
          where: { id: listingId },
          select: LISTING_SELECT,
        });
        if (!listing) {
          throw new NotFoundException('Anúncio não encontrado.');
        }
        if (listing.userId === userId) {
          throw new BadRequestException(
            'Você não pode comprar o próprio anúncio.',
          );
        }
        if (listing.status !== 'ACTIVE') {
          throw new ConflictException('Anúncio não está mais ativo.');
        }
        if (listing.expiresAt.getTime() <= Date.now()) {
          await tx.gachaListing.update({
            where: { id: listingId },
            data: { status: 'EXPIRED' },
          });
          throw new ConflictException('Anúncio expirado.');
        }
        const sold = await tx.gachaListing.updateMany({
          where: { id: listingId, status: 'ACTIVE' },
          data: {
            status: 'SOLD',
            buyerId: userId,
            completedAt: new Date(),
          },
        });
        if (sold.count !== 1) {
          throw new ConflictException('Anúncio não está mais ativo.');
        }
        const moved = await tx.userCard.updateMany({
          where: { id: listing.userCardId, userId: listing.userId },
          data: { userId },
        });
        if (moved.count !== 1) {
          throw new ConflictException(
            'A carta mudou de dono — compra cancelada.',
          );
        }
        await tx.gachaCardDiscovery.createMany({
          data: { userId, cardId: listing.userCard.card.id },
          skipDuplicates: true,
        });
        await tx.user.updateMany({
          where: { id: listing.userId, featuredUserCardId: listing.userCardId },
          data: {
            featuredUserCardId: null,
            featuredSettledAt: null,
          },
        });
        await this.changeCrystals(
          tx,
          userId,
          -listing.price,
          'PURCHASE',
          listingId,
          `Compra no mercado: ${listing.userCard.card.name}`,
        );
        const fee = Math.round(listing.price * GACHA_MARKET_TAX_PCT);
        await this.changeCrystals(
          tx,
          listing.userId,
          listing.price,
          'SALE',
          listingId,
          `Venda: ${listing.userCard.card.name}`,
        );
        if (fee > 0) {
          await this.changeCrystals(
            tx,
            listing.userId,
            -fee,
            'TAX',
            listingId,
            'Taxa do mercado (10%)',
          );
        }
        return { purchased: listing.id, price: listing.price };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async drawFromTier(tier: GachaTier, userId: string) {
    const favorite = (await this.pilotEnabled(userId))
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            favoriteCollection: {
              select: {
                id: true,
                version: true,
                progress: {
                  where: { userId },
                  select: {
                    version: true,
                    reward25At: true,
                    reward100At: true,
                  },
                },
              },
            },
          },
        })
      : null;
    const activeFavorite = favorite?.favoriteCollection;
    const currentProgress = activeFavorite?.progress.find(
      (progress) => progress.version === activeFavorite.version,
    );
    const collectionId =
      activeFavorite &&
      currentProgress?.reward25At &&
      !currentProgress.reward100At
        ? activeFavorite.id
        : null;
    const baseWhere: Prisma.CardWhereInput = {
      rarity: tier,
      status: 'ACTIVE',
    };
    const [favored, other] = collectionId
      ? await this.prisma.$transaction([
          this.prisma.card.count({
            where: {
              ...baseWhere,
              collectionMembers: { some: { collectionId } },
            },
          }),
          this.prisma.card.count({
            where: {
              ...baseWhere,
              collectionMembers: { none: { collectionId } },
            },
          }),
        ])
      : [0, await this.prisma.card.count({ where: baseWhere })];
    const chooseFavored =
      favored > 0 && Math.random() * (favored * 1.15 + other) < favored * 1.15;
    const poolSize = chooseFavored ? favored : other;
    const card = await this.prisma.card.findFirst({
      where: {
        ...baseWhere,
        ...(collectionId
          ? {
              collectionMembers: chooseFavored
                ? { some: { collectionId } }
                : { none: { collectionId } },
            }
          : {}),
      },
      skip: Math.floor(Math.random() * poolSize),
      select: {
        id: true,
        name: true,
        image: true,
        rarity: true,
        favourites: true,
        animeId: true,
        animeTitle: true,
      },
    });
    if (!card) {
      throw new NotFoundException('Pool do gacha vazio. Seed pendente.');
    }
    return card;
  }

  async roll() {
    await Promise.resolve();
    throw new GoneException(
      'A carta diária foi desativada. Use os 5 giros por hora.',
    );
  }

  async collection(
    ownerId: string,
    viewerId: string | null,
    page = 1,
    limit = 24,
    sort = 'value',
    rarity?: string,
    foil?: string,
  ) {
    if (ownerId !== viewerId) {
      const privacy = await this.prisma.privacySettings.findUnique({
        where: { userId: ownerId },
        select: { showGacha: true },
      });
      if (privacy && !privacy.showGacha) {
        throw new ForbiddenException('Coleção privada.');
      }
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const where: Prisma.UserCardWhereInput = {
      userId: ownerId,
      status: 'ACTIVE',
      ...(rarity && (GACHA_TIERS as readonly string[]).includes(rarity)
        ? { card: { rarity } }
        : {}),
      ...(foil && ['NORMAL', 'HOLO', 'GOLD'].includes(foil) ? { foil } : {}),
    };
    const orderBy: Prisma.UserCardOrderByWithRelationInput =
      sort === 'recent'
        ? { obtainedAt: 'desc' }
        : sort === 'rarity'
          ? { card: { rarity: 'desc' } }
          : sort === 'edition'
            ? { edition: 'asc' }
            : { value: 'desc' };
    const [pulls, total, stats, owner] = await this.prisma.$transaction([
      this.prisma.userCard.findMany({
        where,
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        orderBy,
        select: PULL_SELECT,
      }),
      this.prisma.userCard.count({ where }),
      this.prisma.userCard.aggregate({
        where,
        _sum: { value: true },
      }),
      this.prisma.user.findUnique({
        where: { id: ownerId },
        select: {
          pinnedCollectionIds: true,
          gachaCollectionProgress: {
            where: { reward100At: { not: null } },
            select: {
              collectionId: true,
              version: true,
              collection: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    const medals = (owner?.gachaCollectionProgress ?? [])
      .filter((progress) =>
        owner?.pinnedCollectionIds.includes(progress.collectionId),
      )
      .slice(0, 3)
      .map((progress) => ({
        id: progress.collectionId,
        name: progress.collection.name,
        version: progress.version,
      }));

    return {
      data: pulls.map(presentPull),
      stats: { total, totalValue: stats._sum.value ?? 0, medals },
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /** True se o dono possui pelo menos uma cópia de cada carta do set do anime. */
  private async setCompleteFor(userId: string, animeId: string | null) {
    if (!animeId) return false;
    const [total, owned] = await this.prisma.$transaction([
      this.prisma.card.count({ where: { animeId } }),
      this.prisma.userCard.findMany({
        where: { userId, status: 'ACTIVE', card: { animeId } },
        select: { cardId: true },
      }),
    ]);
    if (total === 0) return false;
    return new Set(owned.map((row) => row.cardId)).size >= total;
  }

  async featured(userId: string) {
    const enabled = await this.pilotEnabled(userId);
    const claimed = await this.settleFeatured(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        featuredStartedAt: true,
        featuredSettledAt: true,
        featuredUserCard: { select: PULL_SELECT },
      },
    });
    const pull = user?.featuredUserCard;
    if (!pull) return null;
    const setComplete = await this.setCompleteFor(userId, pull.card.animeId);
    const medal = await this.prisma.gachaCollectionProgress.findFirst({
      where: {
        userId,
        reward100At: { not: null },
        collection: { members: { some: { cardId: pull.card.id } } },
      },
      select: { collection: { select: { id: true, name: true } } },
    });
    return {
      ...presentPull(pull),
      setComplete,
      featured: {
        enabled,
        claimed,
        startedAt: user.featuredStartedAt?.toISOString() ?? null,
        settledAt: user.featuredSettledAt?.toISOString() ?? null,
        ratePercentPerTwoHours: medal ? 1.05 : 1,
        dailyCapPercent: medal ? 5.25 : 5,
        accumulationDays: 7,
        medal: medal?.collection ?? null,
      },
    };
  }

  async setFeatured(userId: string, userCardId: string) {
    const card = await this.prisma.userCard.findFirst({
      where: { id: userCardId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!card) throw new NotFoundException('Carta não encontrada.');
    await this.settleFeatured(userId);
    const now = new Date();
    const state = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { featuredStartedAt: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        featuredUserCardId: card.id,
        featuredStartedAt: state.featuredStartedAt ?? now,
        featuredSettledAt: now,
      },
    });
    return this.featured(userId);
  }

  async removeFeatured(userId: string) {
    const claimed = await this.settleFeatured(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        featuredUserCardId: null,
        featuredSettledAt: null,
      },
    });
    return { featuredUserCardId: null, claimed };
  }

  async crystals(userId: string, page = 1, limit = 20) {
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit)) {
      throw new BadRequestException('Paginação inválida.');
    }
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safePage = Math.max(page, 1);
    if (!Number.isSafeInteger((safePage - 1) * safeLimit)) {
      throw new BadRequestException('Paginação inválida.');
    }
    const todayStart = this.dayStartUtc();
    const [events, total, wallet, dailyBonus] = await this.prisma.$transaction([
      this.prisma.crystalEvent.findMany({
        where: { userId },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.crystalEvent.count({ where: { userId } }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { crystalBalance: true },
      }),
      this.prisma.gachaDailyBonus.findUnique({
        where: { userId },
        select: { lastClaim: true },
      }),
    ]);
    return {
      balance: wallet.crystalBalance,
      dailyClaimedToday: !!dailyBonus && dailyBonus.lastClaim >= todayStart,
      events,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async skinCatalog(userId: string, page = 1, limit = 48, search?: string) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const term = search?.trim();
    const where: Prisma.GachaSkinWhereInput = {
      active: true,
      blocked: false,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { card: { name: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const skinSelect: Prisma.GachaSkinSelect = {
      id: true,
      name: true,
      imageUrl: true,
      sourceUrl: true,
      active: true,
      blocked: true,
      card: { select: { id: true, name: true, malCharacterId: true } },
      owners: {
        where: { userId },
        select: { acquiredAt: true, name: true, imageUrl: true },
      },
    };
    const [total, skins, ownedSkins, user] = await this.prisma.$transaction([
      this.prisma.gachaSkin.count({ where }),
      this.prisma.gachaSkin.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: skinSelect,
      }),
      this.prisma.gachaSkin.findMany({
        where: { ...where, owners: { some: { userId } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: skinSelect,
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          crystalBalance: true,
          equippedGachaSkinId: true,
          nextGachaSkinSpinAt: true,
        },
      }),
    ]);
    const now = Date.now();
    const nextSpinAt = user.nextGachaSkinSpinAt;
    const present = (skin: (typeof skins)[number]) => {
      const { owners, ...rest } = skin;
      const owned = owners[0];
      return {
        ...rest,
        ...(owned ? { name: owned.name, imageUrl: owned.imageUrl } : {}),
        owned: owned !== undefined,
        acquiredAt: owned?.acquiredAt ?? null,
        equipped: rest.id === user.equippedGachaSkinId,
      };
    };
    return {
      skins: skins.map(present),
      owned: ownedSkins.map(present),
      equippedSkinId: user.equippedGachaSkinId,
      crystalBalance: user.crystalBalance,
      canSpin: !nextSpinAt || nextSpinAt.getTime() <= now,
      nextSpinAt: nextSpinAt?.toISOString() ?? null,
      spinPrice: SKIN_SPIN_PRICE,
      cooldownHours: 12,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  }

  async spinSkin(userId: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { crystalBalance: true, nextGachaSkinSpinAt: true },
        });
        if (!user) throw new NotFoundException('Usuário não encontrado.');
        const skins = await tx.gachaSkin.findMany({
          where: {
            active: true,
            blocked: false,
            owners: { none: { userId } },
            card: {
              is: { owners: { some: { userId, status: 'ACTIVE' } } },
            },
          },
          select: {
            id: true,
            name: true,
            imageUrl: true,
            sourceUrl: true,
            card: { select: { id: true, name: true, malCharacterId: true } },
          },
        });
        if (skins.length === 0) {
          throw new ConflictException('Coleção de skins completa.');
        }
        const now = new Date();
        const free =
          user.nextGachaSkinSpinAt === null ||
          user.nextGachaSkinSpinAt.getTime() <= now.getTime();
        const picked = skins[randomInt(skins.length)];
        if (!picked) throw new ConflictException('Nenhuma skin disponível.');
        if (!free) {
          await this.changeCrystals(
            tx,
            userId,
            -SKIN_SPIN_PRICE,
            CrystalEventType.SPEND,
            picked.id,
            'Giro de skin',
          );
        }
        await tx.userGachaSkin.create({
          data: {
            userId,
            skinId: picked.id,
            name: picked.name,
            imageUrl: picked.imageUrl,
          },
        });
        const nextSpinAt = new Date(now.getTime() + SKIN_SPIN_COOLDOWN_MS);
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { nextGachaSkinSpinAt: nextSpinAt },
          select: { crystalBalance: true },
        });
        return {
          skin: picked,
          paid: !free,
          nextSpinAt,
          crystalBalance: updatedUser.crystalBalance,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return {
      ...result,
      nextSpinAt: result.nextSpinAt.toISOString(),
      price: result.paid ? SKIN_SPIN_PRICE : 0,
    };
  }

  async equipSkin(userId: string, skinId: string | null) {
    if (skinId !== null) {
      const owned = await this.prisma.userGachaSkin.findUnique({
        where: { userId_skinId: { userId, skinId } },
        select: { skin: { select: { blocked: true } } },
      });
      if (!owned)
        throw new NotFoundException('Skin não encontrada na coleção.');
      if (owned.skin.blocked) throw new ForbiddenException('Skin bloqueada.');
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { equippedGachaSkinId: skinId },
      select: { equippedGachaSkinId: true },
    });
    return { equippedSkinId: user.equippedGachaSkinId };
  }

  async cardSkins(userId: string, userCardId: string) {
    const card = await this.prisma.userCard.findFirst({
      where: { id: userCardId, userId, status: 'ACTIVE' },
      select: {
        cardId: true,
        skinId: true,
        card: { select: { image: true } },
      },
    });
    if (!card) throw new NotFoundException('Carta não encontrada.');
    const owned = await this.prisma.userGachaSkin.findMany({
      where: {
        userId,
        skin: { cardId: card.cardId, active: true, blocked: false },
      },
      orderBy: { acquiredAt: 'desc' },
      select: {
        skinId: true,
        name: true,
        imageUrl: true,
      },
    });
    return {
      skins: owned,
      selectedSkinId: card.skinId,
      baseImage: card.card.image,
    };
  }

  async applyCardSkin(
    userId: string,
    userCardId: string,
    skinId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.userCard.findFirst({
        where: { id: userCardId, userId, status: 'ACTIVE' },
        select: { id: true, cardId: true },
      });
      if (!card) throw new NotFoundException('Carta não encontrada.');
      if (skinId !== null) {
        const owned = await tx.userGachaSkin.findFirst({
          where: {
            userId,
            skinId,
            skin: {
              cardId: card.cardId,
              active: true,
              blocked: false,
            },
          },
          select: { id: true },
        });
        if (!owned) {
          throw new ForbiddenException('Skin indisponível para esta carta.');
        }
      }
      const updated = await tx.userCard.update({
        where: { id: card.id },
        data: { skinId },
        select: PULL_SELECT,
      });
      return presentPull(updated);
    });
  }

  adminCreateSkin(data: {
    name: string;
    imageUrl: string;
    cardId?: string;
    sourceUrl?: string;
    active?: boolean;
  }) {
    if (data.cardId) {
      return this.prisma.card
        .findUnique({ where: { id: data.cardId }, select: { image: true } })
        .then((card) => {
          if (!card) throw new NotFoundException('Carta não encontrada.');
          if (card.image && card.image === data.imageUrl)
            throw new BadRequestException(
              'A skin precisa ter uma arte diferente da carta base.',
            );
          return this.prisma.gachaSkin.create({
            data: {
              name: data.name,
              imageUrl: data.imageUrl,
              cardId: data.cardId,
              sourceUrl: data.sourceUrl,
              active: data.active ?? true,
            },
          });
        });
    }
    return this.prisma.gachaSkin.create({
      data: {
        name: data.name,
        imageUrl: data.imageUrl,
        cardId: data.cardId,
        sourceUrl: data.sourceUrl,
        active: data.active ?? true,
      },
    });
  }

  adminUpdateSkin(
    id: string,
    data: {
      name?: string;
      imageUrl?: string;
      sourceUrl?: string;
      active?: boolean;
      blocked?: boolean;
    },
  ) {
    return this.prisma.gachaSkin.update({ where: { id }, data });
  }

  async dailyBonus(userId: string) {
    const now = new Date();
    const todayStart = this.dayStartUtc(now);
    const amount = 200;

    await this.prisma.$transaction(async (tx) => {
      await tx.gachaDailyBonus.createMany({
        data: { userId, lastClaim: new Date(0) },
        skipDuplicates: true,
      });
      const claimed = await tx.gachaDailyBonus.updateMany({
        where: { userId, lastClaim: { lt: todayStart } },
        data: { lastClaim: now },
      });
      if (claimed.count !== 1) {
        throw new ForbiddenException('Bônus diário já resgatado hoje.');
      }
      await this.changeCrystals(
        tx,
        userId,
        amount,
        'DAILY',
        null,
        'Bônus diário',
      );
    });

    const wallet = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { crystalBalance: true },
    });
    return { balance: wallet.crystalBalance, claimed: amount };
  }

  async publicCard(id: string) {
    const pull = await this.prisma.userCard.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        user: {
          OR: [
            { privacySettings: null },
            { privacySettings: { is: { showGacha: true } } },
          ],
        },
      },
      select: PULL_SELECT,
    });
    if (!pull) throw new NotFoundException('Carta não encontrada.');
    return presentPull(pull);
  }

  async publicFeatured(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        OR: [
          { privacySettings: null },
          { privacySettings: { is: { showGacha: true } } },
        ],
      },
      select: { featuredUserCard: { select: PULL_SELECT } },
    });
    if (!user) throw new NotFoundException('Carta não encontrada.');
    const pull = user.featuredUserCard;
    if (!pull) return null;
    const setComplete = await this.setCompleteFor(userId, pull.card.animeId);
    return {
      ...presentPull(pull),
      setComplete,
    };
  }

  /**
   * Catálogo completo (pool por anime) com flag de posse do usuário — usado
   * pela enciclopédia "quais faltam" da coleção. Sem usuário, tudo owned=false.
   */
  async encyclopedia(userId: string | null): Promise<{
    stats: {
      totalCards: number;
      ownedCards: number;
      totalSets: number;
      completeSets: number;
    };
    sets: Array<{
      animeId: string | null;
      animeTitle: string | null;
      animeSlug: string | null;
      total: number;
      owned: number;
      cards: Array<{
        id: string;
        name: string;
        image: string | null;
        imageHidden: boolean;
        rarity: string;
        favourites: number;
        owned: boolean;
        wishlisted: boolean;
        wishlistPriority: string | null;
      }>;
      wishlisted: boolean;
      complete: boolean;
    }>;
  }>;
  async encyclopedia(
    userId: string | null,
    options: {
      view?: 'cards' | 'sets';
      page?: number;
      limit?: number;
      search?: string;
      rarity?: string;
      ownership?: 'all' | 'owned' | 'missing';
      animeId?: string;
      progress?: 'all' | 'near' | 'complete';
    },
  ): Promise<{
    view: 'cards' | 'sets';
    cards: Array<{
      id: string;
      name: string;
      image: string | null;
      imageHidden: boolean;
      rarity: string;
      favourites: number;
      owned: boolean;
      wishlisted: boolean;
      wishlistPriority: string | null;
      animeId: string | null;
      animeTitle: string | null;
    }>;
    sets: Array<{
      animeId: string | null;
      animeTitle: string | null;
      animeSlug: string | null;
      total: number;
      owned: number;
      cards: Array<{
        id: string;
        name: string;
        image: string | null;
        imageHidden: boolean;
        rarity: string;
        favourites: number;
        owned: boolean;
        wishlisted: boolean;
        wishlistPriority: string | null;
      }>;
      wishlisted: boolean;
      complete: boolean;
    }>;
    meta: { total: number; page: number; limit: number; totalPages: number };
    stats: {
      totalCards: number;
      ownedCards: number;
      totalSets: number;
      completeSets: number;
    };
  }>;
  async encyclopedia(
    userId: string | null,
    options: {
      view?: 'cards' | 'sets';
      page?: number;
      limit?: number;
      search?: string;
      rarity?: string;
      ownership?: 'all' | 'owned' | 'missing';
      animeId?: string;
      progress?: 'all' | 'near' | 'complete';
    } = {},
  ) {
    const cards = await this.prisma.card.findMany({
      orderBy: [{ animeTitle: 'asc' }, { name: 'asc' }],
      include: { anime: { select: { id: true, slug: true, title: true } } },
    });
    const ownedRows = userId
      ? await this.prisma.userCard.findMany({
          where: { userId, status: 'ACTIVE' },
          select: { cardId: true },
          distinct: ['cardId'],
        })
      : [];
    const ownedIds = new Set(ownedRows.map((row) => row.cardId));
    const wishlistStates =
      userId && this.wishlistService
        ? await this.wishlistService.cardStates(
            userId,
            cards.map((card) => ({ id: card.id, animeId: card.animeId })),
          )
        : new Map<
            string,
            { direct: boolean; set: boolean; priority: string | null }
          >();

    const byAnime = new Map<
      string | null,
      {
        animeId: string | null;
        animeTitle: string | null;
        animeSlug: string | null;
        total: number;
        owned: number;
        cards: Array<{
          id: string;
          name: string;
          image: string | null;
          imageHidden: boolean;
          rarity: string;
          favourites: number;
          owned: boolean;
          wishlisted: boolean;
          wishlistPriority: string | null;
        }>;
        wishlisted: boolean;
      }
    >();
    for (const card of cards) {
      const key = card.animeId;
      if (!byAnime.has(key)) {
        byAnime.set(key, {
          animeId: key,
          animeTitle: key
            ? (card.anime?.title ?? card.animeTitle ?? null)
            : null,
          animeSlug: card.anime?.slug ?? null,
          total: 0,
          owned: 0,
          cards: [],
          wishlisted: false,
        });
      }
      const set = byAnime.get(key)!;
      set.total += 1;
      const has = ownedIds.has(card.id);
      const wish = wishlistStates.get(card.id);
      if (has) set.owned += 1;
      if (wish?.set) set.wishlisted = true;
      set.cards.push({
        id: card.id,
        image: card.imageHidden ? null : card.image,
        imageHidden: card.imageHidden,
        name: card.imageHidden ? '???' : card.name,
        rarity: card.rarity,
        favourites: card.favourites,
        owned: has,
        wishlisted: Boolean(wish?.direct || wish?.set),
        wishlistPriority: wish?.priority ?? null,
      });
    }

    const sets = [...byAnime.values()].map((set) => ({
      ...set,
      complete: set.total > 0 && set.owned === set.total,
    }));

    const fold = (value: string | null | undefined) =>
      (value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const term = fold(options.search?.trim());
    const allCards = sets.flatMap((set) =>
      set.cards.map((card) => ({
        ...card,
        animeId: set.animeId,
        animeTitle: set.animeTitle,
      })),
    );
    const cardsView = allCards.filter((card) => {
      if (term && !fold(`${card.name} ${card.animeTitle}`).includes(term))
        return false;
      if (options.rarity && card.rarity !== options.rarity) return false;
      if (
        options.animeId &&
        options.animeId !== 'orphan' &&
        card.animeId !== options.animeId
      )
        return false;
      if (options.ownership === 'owned' && !card.owned) return false;
      if (options.ownership === 'missing' && card.owned) return false;
      return true;
    });
    const setsView = sets.filter((set) => {
      if (term && !fold(`${set.animeTitle} ${set.animeSlug}`).includes(term))
        return false;
      if (options.progress === 'complete' && !set.complete) return false;
      if (options.progress === 'near' && (set.complete || set.owned === 0))
        return false;
      return true;
    });
    const view = options.view === 'sets' ? 'sets' : 'cards';
    const source = view === 'sets' ? setsView : cardsView;
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 24));
    const total = source.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const slice = source.slice((page - 1) * limit, page * limit);

    const stats = {
      totalCards: cards.length,
      ownedCards: ownedIds.size,
      totalSets: sets.length,
      completeSets: sets.filter((set) => set.complete).length,
    };
    if (Object.keys(options).length === 0) return { stats, sets };
    return {
      view,
      cards: view === 'cards' ? slice : [],
      sets: view === 'sets' ? slice : [],
      meta: { total, page, limit, totalPages },
      stats,
    };
  }

  async encyclopediaSuggestions(query: string) {
    const term = query.trim();
    if (term.length < 2) return [];
    const rows = await this.prisma.card.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      select: { name: true, animeTitle: true },
      orderBy: { name: 'asc' },
      take: 5,
    });
    return [
      ...new Set(
        rows.flatMap((row) => [row.name, row.animeTitle].filter(Boolean)),
      ),
    ].slice(0, 5);
  }

  collections() {
    return this.prisma.gachaCollection.findMany({
      where: { published: true },
      include: { members: { include: { card: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  adminCreateCollection(data: {
    name: string;
    slug: string;
    description?: string;
    version?: number;
    published?: boolean;
    cardIds?: string[];
  }) {
    return this.prisma.gachaCollection.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        version: data.version ?? 1,
        published: data.published ?? false,
        members: {
          create: (data.cardIds ?? []).map((cardId) => ({
            card: { connect: { id: cardId } },
          })),
        },
      },
      include: { members: true },
    });
  }

  async recent(limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const pulls = await this.prisma.userCard.findMany({
      where: { status: 'ACTIVE' },
      take: safeLimit * 2,
      orderBy: { obtainedAt: 'desc' },
      select: {
        ...PULL_SELECT,
        user: {
          select: {
            id: true,
            name: true,
            userName: true,
            avatar: true,
            privacySettings: { select: { showGacha: true } },
          },
        },
      },
    });

    return pulls
      .filter(
        (pull) =>
          !pull.user.privacySettings || pull.user.privacySettings.showGacha,
      )
      .slice(0, safeLimit)
      .map(({ user, ...pull }) => ({
        ...pull,
        conditionLabel: conditionLabel(pull.condition),
        card: presentCard(pull.card),
        user: {
          id: user.id,
          name: user.name,
          userName: user.userName,
          avatar: user.avatar,
        },
      }));
  }

  async ranking(limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const sums = await this.prisma.userCard.groupBy({
      by: ['userId'],
      _sum: { value: true },
      _count: { _all: true },
      orderBy: { _sum: { value: 'desc' } },
      take: safeLimit * 2,
    });
    if (sums.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: sums.map((sum) => sum.userId) } },
      select: {
        id: true,
        name: true,
        userName: true,
        avatar: true,
        privacySettings: { select: { showGacha: true } },
      },
    });
    const byId = new Map(users.map((user) => [user.id, user]));

    return sums
      .flatMap((sum) => {
        const user = byId.get(sum.userId);
        if (
          !user ||
          (user.privacySettings && !user.privacySettings.showGacha)
        ) {
          return [];
        }
        return [
          {
            user: {
              id: user.id,
              name: user.name,
              userName: user.userName,
              avatar: user.avatar,
            },
            totalValue: sum._sum.value ?? 0,
            pulls: sum._count._all,
          },
        ];
      })
      .slice(0, safeLimit);
  }

  private async pickTierWithStock(
    weights: Record<GachaTier, number>,
  ): Promise<GachaTier> {
    const remaining = { ...weights };
    for (;;) {
      const tiers = Object.keys(remaining) as GachaTier[];
      if (tiers.length === 0) {
        throw new NotFoundException('Pool do gacha vazio. Seed pendente.');
      }
      const tier = pickWeighted(
        Object.fromEntries(
          tiers.map((tier) => [tier, remaining[tier]]),
        ) as Record<GachaTier, number>,
      );
      const count = await this.prisma.card.count({
        where: { rarity: tier },
      });
      if (count > 0) return tier;
      delete remaining[tier];
    }
  }

  async adminCards(
    page = 1,
    limit = 24,
    search?: string,
    rarity?: string,
    animeId?: string,
    status?: string,
    source?: string,
  ) {
    const where: Prisma.CardWhereInput = {};
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (rarity && (GACHA_TIERS as readonly string[]).includes(rarity)) {
      where.rarity = rarity;
    }
    if (animeId) where.animeId = animeId;
    if (status && Object.values(CardStatus).includes(status as CardStatus))
      where.status = status as CardStatus;
    if (source && Object.values(CardSource).includes(source as CardSource))
      where.source = source as CardSource;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.card.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          anime: { select: { id: true, slug: true, title: true, malId: true } },
        },
      }),
      this.prisma.card.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  adminRarities() {
    return this.prisma.gachaRarity.findMany({ orderBy: { pointsBase: 'asc' } });
  }

  adminCreateRarity(data: {
    name: string;
    slug: string;
    pointsBase?: number;
    dropWeight?: number;
    color?: string;
    active?: boolean;
  }) {
    return this.prisma.gachaRarity.create({
      data: {
        ...data,
        pointsBase: data.pointsBase ?? 0,
        dropWeight: data.dropWeight ?? 0,
      },
    });
  }

  adminUpdateRarity(
    id: string,
    data: {
      name?: string;
      slug?: string;
      pointsBase?: number;
      dropWeight?: number;
      color?: string;
      active?: boolean;
    },
  ) {
    return this.prisma.gachaRarity.update({ where: { id }, data });
  }

  adminCreateCard(data: {
    name: string;
    image?: string;
    rarity: string;
    animeId: string;
    imageHidden?: boolean;
    source?: string;
    variantName?: string;
    variantType?: string;
  }) {
    // ponytail: malCharacterId negativo sintético p/ carta manual; colidir
    // com carta real do MAL é impossível (IDs MAL são positivos).
    const malCharacterId = -randomInt(1, 2_000_000_000);
    return this.prisma.card.create({
      data: {
        name: data.name,
        image: data.image,
        imageHidden: data.imageHidden ?? false,
        rarity: data.rarity,
        animeId: data.animeId,
        variantName: data.variantName,
        variantType: data.variantType,
        malCharacterId,
        source: data.source === 'MAL' ? CardSource.MAL : CardSource.MANUAL,
        status: CardStatus.DRAFT,
      },
    });
  }

  async adminUpdateCard(
    id: string,
    data: {
      name?: string;
      image?: string;
      rarity?: string;
      animeId?: string;
      imageHidden?: boolean;
      status?: string;
      variantName?: string;
      variantType?: string;
    },
    actor?: { adminId: string; reason?: string },
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.card.findUnique({
        where: { id },
        select: {
          rarity: true,
          animeId: true,
          image: true,
          imageHidden: true,
          name: true,
        },
      });
      if (!current) throw new NotFoundException('Carta não encontrada.');
      if (
        data.status === 'ACTIVE' &&
        ((!data.animeId && !current.animeId) ||
          (!data.image && !current.image) ||
          (!data.name && !current.name))
      ) {
        throw new BadRequestException(
          'Carta precisa de anime, nome e imagem para publicar.',
        );
      }
      const { status, ...fields } = data;
      const rarityChanged =
        data.rarity !== undefined && data.rarity !== current.rarity;
      const copies = rarityChanged
        ? await tx.userCard.findMany({
            where: { cardId: id, valueOverride: null },
            select: {
              id: true,
              condition: true,
              foil: true,
              edition: true,
              value: true,
            },
          })
        : [];
      const updatedCard = await tx.card.update({
        where: { id },
        data: {
          ...fields,
          ...(status && Object.values(CardStatus).includes(status as CardStatus)
            ? { status: status as CardStatus }
            : {}),
        },
      });
      let previousTotal = 0;
      let nextTotal = 0;
      for (const copy of copies) {
        const nextValue = cardValue(
          updatedCard.rarity as GachaTier,
          copy.condition,
          copy.foil as GachaFoil,
          copy.edition,
        );
        previousTotal += copy.value;
        nextTotal += nextValue;
        await tx.userCard.update({
          where: { id: copy.id },
          data: { value: nextValue },
        });
      }
      if (actor) {
        await tx.gachaAdminChange.create({
          data: {
            adminId: actor.adminId,
            action: rarityChanged ? 'UPDATE_CARD_AND_REPRICE' : 'UPDATE_CARD',
            cardId: id,
            reason: actor.reason,
            before: current,
            after: {
              rarity: updatedCard.rarity,
              animeId: updatedCard.animeId,
              imageHidden: updatedCard.imageHidden,
              repriced: copies.length,
              previousTotal,
              nextTotal,
            },
          },
        });
      }
      return {
        card: updatedCard,
        repriced: copies.length,
        previousTotal,
        nextTotal,
      };
    });
    return {
      ...updated.card,
      repriced: updated.repriced,
      previousTotal: updated.previousTotal,
      nextTotal: updated.nextTotal,
    };
  }

  adminUserCards(userId: string, page = 1, limit = 50) {
    return this.prisma
      .$transaction([
        this.prisma.userCard.findMany({
          where: { userId },
          orderBy: { obtainedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: PULL_SELECT,
        }),
        this.prisma.userCard.count({ where: { userId } }),
      ])
      .then(([data, total]) => ({
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      }));
  }

  async adminGrantUserCard(userId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true, rarity: true, editionCounter: true },
    });
    if (!card) throw new NotFoundException('Carta não encontrada.');

    const condition = Math.random();
    const foil = pickWeighted(GACHA_FOIL_WEIGHTS);
    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.card.update({
        where: { id: card.id },
        data: { editionCounter: { increment: 1 } },
        select: { editionCounter: true },
      });
      return tx.userCard.create({
        data: {
          userId,
          originalUserId: userId,
          cardId: card.id,
          condition,
          foil,
          edition: counter.editionCounter,
          value: cardValue(
            card.rarity as GachaTier,
            condition,
            foil,
            counter.editionCounter,
          ),
        },
        select: PULL_SELECT,
      });
    });
  }

  adminDeleteUserCard(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { featuredUserCardId: id },
        data: {
          featuredUserCardId: null,
          featuredSettledAt: null,
        },
      });
      return tx.userCard.delete({ where: { id } });
    });
  }

  async adminSetUserCardValue(
    id: string,
    value: number | null,
    reason: string,
    adminId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.userCard.findUnique({
        where: { id },
        select: {
          id: true,
          value: true,
          valueOverride: true,
          condition: true,
          foil: true,
          edition: true,
          card: { select: { id: true, rarity: true } },
        },
      });
      if (!current)
        throw new NotFoundException('Carta do usuário não encontrada.');
      const nextValue =
        value ??
        cardValue(
          current.card.rarity as GachaTier,
          current.condition,
          current.foil as GachaFoil,
          current.edition,
        );
      const updated = await tx.userCard.update({
        where: { id },
        data: { value: nextValue, valueOverride: value },
        select: PULL_SELECT,
      });
      await tx.gachaAdminChange.create({
        data: {
          adminId,
          action:
            value === null
              ? 'RESTORE_USER_CARD_VALUE'
              : 'OVERRIDE_USER_CARD_VALUE',
          cardId: current.card.id,
          userCardId: id,
          reason,
          before: {
            value: current.value,
            valueOverride: current.valueOverride,
          },
          after: { value: nextValue, valueOverride: value },
        },
      });
      return presentPull(updated);
    });
  }

  adminGachaHistory(cardId?: string, userCardId?: string) {
    return this.prisma.gachaAdminChange.findMany({
      where: {
        ...(cardId ? { cardId } : {}),
        ...(userCardId ? { userCardId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async adminResetRoll(userId: string) {
    const [day, spins, lock] = await this.prisma.$transaction([
      this.prisma.gachaRollDay.deleteMany({
        where: { userId, day: this.dayStartUtc() },
      }),
      this.prisma.gachaSpin.deleteMany({
        where: { userId, hour: this.hourStartUtc() },
      }),
      this.prisma.gachaClaimLock.deleteMany({ where: { userId } }),
    ]);
    return { day, spins, lock };
  }

  /** Troca 1:1 — dono derivado do token; carta pedida precisa ser de outra pessoa. */
  async createTrade(
    userId: string,
    offeredUserCardId: string | string[],
    requestedUserCardId: string | string[],
  ) {
    if (
      Array.isArray(offeredUserCardId) ||
      Array.isArray(requestedUserCardId)
    ) {
      const offeredIds = Array.isArray(offeredUserCardId)
        ? offeredUserCardId
        : [offeredUserCardId];
      const requestedIds = Array.isArray(requestedUserCardId)
        ? requestedUserCardId
        : [requestedUserCardId];
      if (
        offeredIds.length < 1 ||
        offeredIds.length > 3 ||
        requestedIds.length < 1 ||
        requestedIds.length > 3
      ) {
        throw new BadRequestException(
          'Cada lado deve conter entre 1 e 3 cartas.',
        );
      }
      if (
        new Set([...offeredIds, ...requestedIds]).size !==
        offeredIds.length + requestedIds.length
      ) {
        throw new BadRequestException(
          'Uma carta não pode aparecer duas vezes na troca.',
        );
      }
      const cards = await this.prisma.userCard.findMany({
        where: { id: { in: [...offeredIds, ...requestedIds] } },
        select: {
          id: true,
          userId: true,
          status: true,
          condition: true,
          foil: true,
          value: true,
          card: {
            select: {
              id: true,
              name: true,
              image: true,
              imageHidden: true,
              rarity: true,
              favourites: true,
              animeId: true,
              animeTitle: true,
              anime: {
                select: {
                  id: true,
                  slug: true,
                  title: true,
                  coverImage: true,
                  malId: true,
                },
              },
            },
          },
        },
      });
      if (cards.length !== offeredIds.length + requestedIds.length)
        throw new NotFoundException('Carta não encontrada.');
      const offered = cards.filter((c) => offeredIds.includes(c.id));
      const requested = cards.filter((c) => requestedIds.includes(c.id));
      if (offered.some((c) => c.userId !== userId))
        throw new ForbiddenException('Você não é dono de uma carta oferecida.');
      if (requested.some((c) => c.userId === userId))
        throw new BadRequestException(
          'As cartas pedidas precisam ser de outra pessoa.',
        );
      if (cards.some((c) => c.status && c.status !== 'ACTIVE'))
        throw new BadRequestException('Uma carta não está disponível.');
      const targetUserId = requested[0]!.userId;
      if (requested.some((c) => c.userId !== targetUserId))
        throw new BadRequestException(
          'As cartas pedidas devem pertencer à mesma pessoa.',
        );
      const privacy = await this.prisma.privacySettings.findUnique({
        where: { userId: targetUserId },
        select: { showGacha: true },
      });
      if (privacy && !privacy.showGacha)
        throw new ForbiddenException('A coleção dessa pessoa é privada.');
      const pending = await this.prisma.gachaTradeCard.count({
        where: {
          userCardId: { in: cards.map((c) => c.id) },
          trade: { status: 'PENDING' },
        },
      });
      if (pending)
        throw new ConflictException(
          'Uma dessas cartas já está numa troca pendente.',
        );
      const snapshot = (c: (typeof cards)[number]) => ({
        id: c.id,
        condition: c.condition,
        conditionLabel: conditionLabel(c.condition),
        foil: c.foil,
        value: c.value,
        card: presentCard(c.card),
      });
      const trade = await this.prisma.gachaTrade.create({
        data: {
          offeredUserId: userId,
          offeredUserCardId: offeredIds[0]!,
          requestedUserId: targetUserId,
          requestedUserCardId: requestedIds[0]!,
          expiresAt: new Date(Date.now() + TRADE_TTL_MS),
          cards: {
            create: [
              ...offered.map((c, i) => ({
                userCardId: c.id,
                side: 'OFFERED' as const,
                position: i,
                snapshot: snapshot(c),
              })),
              ...requested.map((c, i) => ({
                userCardId: c.id,
                side: 'REQUESTED' as const,
                position: i,
                snapshot: snapshot(c),
              })),
            ],
          },
        },
        select: TRADE_SELECT,
      });
      return fmtTrade(trade);
    }
    await this.expirePendingTrades();
    if (offeredUserCardId === requestedUserCardId) {
      throw new BadRequestException(
        'Não dá para trocar uma carta com ela mesma.',
      );
    }
    const [offered, requested] = await this.prisma.$transaction([
      this.prisma.userCard.findUnique({
        where: { id: offeredUserCardId },
        select: { id: true, userId: true, status: true },
      }),
      this.prisma.userCard.findUnique({
        where: { id: requestedUserCardId },
        select: { id: true, userId: true, status: true },
      }),
    ]);
    if (!offered)
      throw new NotFoundException('Carta oferecida não encontrada.');
    if (!requested) throw new NotFoundException('Carta pedida não encontrada.');
    if (offered.status && offered.status !== 'ACTIVE') {
      throw new BadRequestException('Carta oferecida não está disponível.');
    }
    if (requested.status && requested.status !== 'ACTIVE') {
      throw new BadRequestException('Carta pedida não está disponível.');
    }
    if (offered.userId !== userId) {
      throw new ForbiddenException('Você não é dono da carta oferecida.');
    }
    if (requested.userId === userId) {
      throw new BadRequestException(
        'A carta pedida precisa ser de outra pessoa.',
      );
    }

    const privacy = await this.prisma.privacySettings.findUnique({
      where: { userId: requested.userId },
      select: { showGacha: true },
    });
    if (privacy && !privacy.showGacha) {
      throw new ForbiddenException('A coleção dessa pessoa é privada.');
    }

    const [
      offeredActive,
      requestedActive,
      sentByMe,
      pendingForMe,
      listedCount,
    ] = await this.prisma.$transaction([
      this.prisma.gachaTrade.count({
        where: { offeredUserCardId, status: 'PENDING' },
      }),
      this.prisma.gachaTrade.count({
        where: { requestedUserCardId, status: 'PENDING' },
      }),
      this.prisma.gachaTrade.count({
        where: { offeredUserId: userId, status: 'PENDING' },
      }),
      this.prisma.gachaTrade.count({
        where: { requestedUserId: userId, status: 'PENDING' },
      }),
      this.prisma.gachaListing.count({
        where: {
          userCardId: { in: [offeredUserCardId, requestedUserCardId] },
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
      }),
    ]);
    if (offeredActive > 0 || requestedActive > 0) {
      throw new ConflictException(
        'Uma dessas cartas já está numa troca pendente.',
      );
    }
    if (listedCount > 0) {
      throw new ConflictException(
        'Uma dessas cartas está anunciada no mercado.',
      );
    }
    if (sentByMe >= TRADE_ACTIVE_LIMIT) {
      throw new ConflictException(
        `Limite de ${TRADE_ACTIVE_LIMIT} propostas enviadas ativas.`,
      );
    }
    if (pendingForMe >= TRADE_ACTIVE_LIMIT) {
      throw new ConflictException(
        `Limite de ${TRADE_ACTIVE_LIMIT} propostas recebidas ativas.`,
      );
    }

    try {
      const trade = await this.prisma.gachaTrade.create({
        data: {
          offeredUserId: userId,
          offeredUserCardId,
          requestedUserId: requested.userId,
          requestedUserCardId,
          expiresAt: new Date(Date.now() + TRADE_TTL_MS),
        },
        select: TRADE_SELECT,
      });
      return fmtTrade(trade);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Uma dessas cartas acabou de entrar numa troca pendente.',
        );
      }
      throw e;
    }
  }

  async myTrades(userId: string) {
    const trades = await this.prisma.gachaTrade.findMany({
      where: { OR: [{ offeredUserId: userId }, { requestedUserId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: TRADE_SELECT,
    });
    return trades.map(fmtTrade);
  }

  async acceptTrade(userId: string, tradeId: string) {
    await this.expireTrade(tradeId);
    const parties = await this.prisma.gachaTrade.findUnique({
      where: { id: tradeId },
      select: { offeredUserId: true, requestedUserId: true },
    });
    if (parties) {
      await this.settleFeatured(parties.offeredUserId);
      await this.settleFeatured(parties.requestedUserId);
    }
    return this.prisma.$transaction(async (tx) => {
      const trade = await tx.gachaTrade.findUnique({
        where: { id: tradeId },
        select: TRADE_SELECT,
      });
      if (!trade) throw new NotFoundException('Troca não encontrada.');
      if (trade.requestedUserId !== userId) {
        throw new ForbiddenException('Só o receptor pode aceitar a troca.');
      }
      if (trade.status === 'EXPIRED') {
        throw new ConflictException('Troca já expirada.');
      }
      if (trade.status !== 'PENDING') {
        throw new ConflictException('Troca não está mais pendente.');
      }
      if (Date.now() >= trade.expiresAt.getTime()) {
        throw new ConflictException('Troca expirada.');
      }

      const accepted = await tx.gachaTrade.updateMany({
        where: { id: tradeId, status: 'PENDING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (accepted.count !== 1) {
        throw new ConflictException('Troca não está mais pendente.');
      }

      const offeredIds = trade.cards?.length
        ? trade.cards
            .filter((c) => c.side === 'OFFERED')
            .map((c) => c.userCardId)
        : [trade.offeredUserCardId];
      const requestedIds = trade.cards?.length
        ? trade.cards
            .filter((c) => c.side === 'REQUESTED')
            .map((c) => c.userCardId)
        : [trade.requestedUserCardId];
      const owners = await tx.userCard.findMany({
        where: { id: { in: [...offeredIds, ...requestedIds] } },
        select: { id: true, userId: true, cardId: true },
      });
      if (
        owners.length !== offeredIds.length + requestedIds.length ||
        owners.some((c) =>
          offeredIds.includes(c.id)
            ? c.userId !== trade.offeredUserId
            : c.userId !== trade.requestedUserId,
        )
      ) {
        throw new ConflictException(
          'Uma das cartas mudou de dono — a troca foi invalidada.',
        );
      }

      // Carta que era a destaque do antigo dono perde o destaque na troca.
      await tx.user.updateMany({
        where: {
          id: trade.offeredUserId,
          featuredUserCardId: trade.offeredUserCard.id,
        },
        data: {
          featuredUserCardId: null,
          featuredSettledAt: null,
        },
      });
      await tx.user.updateMany({
        where: {
          id: trade.requestedUserId,
          featuredUserCardId: trade.requestedUserCard.id,
        },
        data: {
          featuredUserCardId: null,
          featuredSettledAt: null,
        },
      });

      const offered = await tx.userCard.updateMany({
        where: { id: { in: offeredIds }, userId: trade.offeredUserId },
        data: { userId: trade.requestedUserId },
      });
      const requested = await tx.userCard.updateMany({
        where: { id: { in: requestedIds }, userId: trade.requestedUserId },
        data: { userId: trade.offeredUserId },
      });
      if (
        offered.count !== offeredIds.length ||
        requested.count !== requestedIds.length
      ) {
        throw new ConflictException('Uma das cartas mudou de dono.');
      }
      await tx.gachaCardDiscovery.createMany({
        data: [
          ...offeredIds.map((id) => ({
            userId: trade.requestedUserId,
            cardId: owners.find((card) => card.id === id)!.cardId,
          })),
          ...requestedIds.map((id) => ({
            userId: trade.offeredUserId,
            cardId: owners.find((card) => card.id === id)!.cardId,
          })),
        ],
        skipDuplicates: true,
      });

      const done = await tx.gachaTrade.update({
        where: { id: tradeId },
        data: { status: 'COMPLETED', completedAt: new Date() },
        select: TRADE_SELECT,
      });
      return fmtTrade(done);
    });
  }

  async cancelTrade(userId: string, tradeId: string) {
    return this.settleTrade(userId, tradeId, 'offeredUserId', 'cancelar');
  }

  async declineTrade(userId: string, tradeId: string) {
    return this.settleTrade(userId, tradeId, 'requestedUserId', 'recusar');
  }

  private async settleTrade(
    userId: string,
    tradeId: string,
    actorField: 'offeredUserId' | 'requestedUserId',
    verb: string,
  ) {
    await this.expireTrade(tradeId);
    return this.prisma.$transaction(async (tx) => {
      const trade = await tx.gachaTrade.findUnique({
        where: { id: tradeId },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          offeredUserId: true,
          requestedUserId: true,
        },
      });
      if (!trade) throw new NotFoundException('Troca não encontrada.');
      if (trade[actorField] !== userId) {
        throw new ForbiddenException(`Só o ${verb} da troca pode agir aqui.`);
      }
      if (trade.status === 'EXPIRED') {
        throw new ConflictException('Troca já expirada.');
      }
      if (trade.status !== 'PENDING') {
        throw new ConflictException('Troca não está mais pendente.');
      }
      if (Date.now() >= trade.expiresAt.getTime()) {
        throw new ConflictException('Troca expirada.');
      }
      const cancelled = await tx.gachaTrade.updateMany({
        where: { id: tradeId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      if (cancelled.count !== 1) {
        throw new ConflictException('Troca não está mais pendente.');
      }
      return { id: tradeId, status: 'CANCELLED' };
    });
  }

  private async expireTrade(tradeId: string): Promise<void> {
    await this.prisma.gachaTrade.updateMany({
      where: { id: tradeId, status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }

  private async expirePendingTrades(): Promise<void> {
    await this.prisma.gachaTrade.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }

  private async publishPullPost(userId: string, pull: Pull) {
    const privacy = await this.prisma.privacySettings.findUnique({
      where: { userId },
      select: { showGacha: true },
    });
    if (privacy && !privacy.showGacha) return null;

    const card = presentCard(pull.card);
    return this.prisma.post.create({
      data: {
        userId,
        kind: 'GACHA_PULL',
        content: `Tirou ${card.name} — ${card.rarity} ${pull.foil} ${conditionLabel(pull.condition)} #${pull.edition}`,
        animeId: pull.card.animeId,
        meta: {
          userCardId: pull.id,
          cardId: pull.card.id,
          name: card.name,
          image: card.image,
          imageHidden: card.imageHidden,
          rarity: pull.card.rarity,
          foil: pull.foil,
          condition: pull.condition,
          edition: pull.edition,
          value: pull.value,
        },
      },
      select: { id: true },
    });
  }
}
