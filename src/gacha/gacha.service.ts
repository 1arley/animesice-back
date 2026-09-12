import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  GACHA_BYPASS_PRICE_CENTS,
  GACHA_CLAIM_LOCK_MS,
  GACHA_FOIL_WEIGHTS,
  GACHA_PITY_DAYS,
  GACHA_PITY_WEIGHTS,
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

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TRADE_TTL_MS = 48 * HOUR_MS;
const TRADE_ACTIVE_LIMIT = 3;
const EPIC_RARITIES = ['EPICA', 'LENDARIA', 'MITICA', 'GALACTICA'];

const PULL_SELECT = {
  id: true,
  condition: true,
  foil: true,
  edition: true,
  value: true,
  obtainedAt: true,
  user: { select: { id: true, name: true, userName: true, avatar: true } },
  card: {
    select: {
      id: true,
      name: true,
      image: true,
      rarity: true,
      favourites: true,
      animeId: true,
      animeTitle: true,
      anime: {
        select: { id: true, slug: true, title: true, coverImage: true },
      },
    },
  },
} satisfies Prisma.UserCardSelect;

type Pull = Prisma.UserCardGetPayload<{ select: typeof PULL_SELECT }>;

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
      rarity: true,
      favourites: true,
      animeId: true,
      animeTitle: true,
      anime: {
        select: { id: true, slug: true, title: true, coverImage: true },
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
} satisfies Prisma.GachaTradeSelect;

type TradeRow = Prisma.GachaTradeGetPayload<{ select: typeof TRADE_SELECT }>;

const fmtTrade = (t: TradeRow) => ({
  ...t,
  offeredUserCard: {
    ...t.offeredUserCard,
    conditionLabel: conditionLabel(t.offeredUserCard.condition),
  },
  requestedUserCard: {
    ...t.requestedUserCard,
    conditionLabel: conditionLabel(t.requestedUserCard.condition),
  },
});

@Injectable()
export class GachaService {
  private readonly logger = new Logger(GachaService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  private async pityState(userId: string) {
    const [lastEpic, first] = await this.prisma.$transaction([
      this.prisma.userCard.findFirst({
        where: { userId, card: { rarity: { in: EPIC_RARITIES } } },
        orderBy: { obtainedAt: 'desc' },
        select: { obtainedAt: true },
      }),
      this.prisma.userCard.findFirst({
        where: { userId },
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
    const hour = this.hourStartUtc();
    const [spinsUsed, claim, pity, first] = await this.prisma.$transaction([
      this.prisma.gachaSpin.count({ where: { userId, hour } }),
      this.prisma.gachaClaimLock.findUnique({ where: { userId } }),
      this.prisma.userCard.findFirst({
        where: { userId, card: { rarity: { in: EPIC_RARITIES } } },
        orderBy: { obtainedAt: 'desc' },
        select: { obtainedAt: true },
      }),
      this.prisma.userCard.findFirst({
        where: { userId },
        orderBy: { obtainedAt: 'asc' },
        select: { obtainedAt: true },
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
    }));
  }

  async spin(userId: string) {
    const hour = this.hourStartUtc();

    const pity = await this.pityState(userId);
    const tier = await this.pickTierWithStock(
      pity.pityDue ? GACHA_PITY_WEIGHTS : GACHA_TIER_WEIGHTS,
    );
    const card = await this.drawFromTier(tier);

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
              'Você já guardou uma carta nas últimas 12h.',
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
          const claimed = await tx.gachaSpin.updateMany({
            where: { id: spin.id, claimedAt: null },
            data: { claimedAt: new Date() },
          });
          if (claimed.count !== 1) {
            throw new NotFoundException('Preview expirada ou já resgatada.');
          }
          await tx.gachaClaimLock.upsert({
            where: { userId },
            create: {
              userId,
              lockedUntil: new Date(Date.now() + GACHA_CLAIM_LOCK_MS),
            },
            update: { lockedUntil: new Date(Date.now() + GACHA_CLAIM_LOCK_MS) },
          });
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

    return {
      ...pull,
      conditionLabel: conditionLabel(pull.condition),
    };
  }

  async unlockClaim(userId: string) {
    const lock = await this.prisma.gachaClaimLock.findUnique({
      where: { userId },
    });
    if (lock === null || lock.lockedUntil.getTime() <= Date.now()) {
      return { unlocked: false as const };
    }
    await this.prisma.gachaClaimLock.delete({ where: { userId } });
    return { unlocked: true as const };
  }

  private async drawFromTier(tier: GachaTier) {
    const poolSize = await this.prisma.card.count({
      where: { rarity: tier },
    });
    const card = await this.prisma.card.findFirst({
      where: { rarity: tier },
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
    const [pulls, total, stats] = await this.prisma.$transaction([
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
    ]);

    return {
      data: pulls.map((pull) => ({
        ...pull,
        conditionLabel: conditionLabel(pull.condition),
      })),
      stats: { total, totalValue: stats._sum.value ?? 0 },
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
        where: { userId, card: { animeId } },
        select: { cardId: true },
      }),
    ]);
    if (total === 0) return false;
    return new Set(owned.map((row) => row.cardId)).size >= total;
  }

  async featured(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { featuredUserCard: { select: PULL_SELECT } },
    });
    const pull = user?.featuredUserCard;
    if (!pull) return null;
    const setComplete = await this.setCompleteFor(userId, pull.card.animeId);
    return {
      ...pull,
      conditionLabel: conditionLabel(pull.condition),
      setComplete,
    };
  }

  async setFeatured(userId: string, userCardId: string) {
    const card = await this.prisma.userCard.findFirst({
      where: { id: userCardId, userId },
      select: { id: true },
    });
    if (!card) throw new NotFoundException('Carta não encontrada.');
    await this.prisma.user.update({
      where: { id: userId },
      data: { featuredUserCardId: card.id },
    });
    return this.featured(userId);
  }

  async removeFeatured(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { featuredUserCardId: null },
    });
    return { featuredUserCardId: null };
  }

  async publicCard(id: string) {
    const pull = await this.prisma.userCard.findFirst({
      where: {
        id,
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
    return { ...pull, conditionLabel: conditionLabel(pull.condition) };
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
      ...pull,
      conditionLabel: conditionLabel(pull.condition),
      setComplete,
    };
  }

  /**
   * Catálogo completo (pool por anime) com flag de posse do usuário — usado
   * pela enciclopédia "quais faltam" da coleção. Sem usuário, tudo owned=false.
   */
  async encyclopedia(userId: string | null) {
    const cards = await this.prisma.card.findMany({
      orderBy: [{ animeTitle: 'asc' }, { name: 'asc' }],
      include: { anime: { select: { id: true, slug: true, title: true } } },
    });
    const ownedRows = userId
      ? await this.prisma.userCard.findMany({
          where: { userId },
          select: { cardId: true },
          distinct: ['cardId'],
        })
      : [];
    const ownedIds = new Set(ownedRows.map((row) => row.cardId));

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
          rarity: string;
          favourites: number;
          owned: boolean;
        }>;
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
        });
      }
      const set = byAnime.get(key)!;
      set.total += 1;
      const has = ownedIds.has(card.id);
      if (has) set.owned += 1;
      set.cards.push({
        id: card.id,
        name: card.name,
        image: card.image,
        rarity: card.rarity,
        favourites: card.favourites,
        owned: has,
      });
    }

    const sets = [...byAnime.values()].map((set) => ({
      ...set,
      complete: set.total > 0 && set.owned === set.total,
    }));

    return {
      stats: {
        totalCards: cards.length,
        ownedCards: ownedIds.size,
        totalSets: sets.length,
        completeSets: sets.filter((set) => set.complete).length,
      },
      sets,
    };
  }

  async recent(limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const pulls = await this.prisma.userCard.findMany({
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

  async adminCards(page = 1, limit = 24, search?: string, rarity?: string) {
    const where: Prisma.CardWhereInput = {};
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (rarity && (GACHA_TIERS as readonly string[]).includes(rarity)) {
      where.rarity = rarity;
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.card.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.card.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  adminCreateCard(data: { name: string; image?: string; rarity: string }) {
    // ponytail: malCharacterId negativo sintético p/ carta manual; colidir
    // com carta real do MAL é impossível (IDs MAL são positivos).
    const malCharacterId = -Date.now();
    return this.prisma.card.create({ data: { ...data, malCharacterId } });
  }

  adminUpdateCard(
    id: string,
    data: { name?: string; image?: string; rarity?: string },
  ) {
    return this.prisma.card.update({ where: { id }, data });
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
        data: { featuredUserCardId: null },
      });
      return tx.userCard.delete({ where: { id } });
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
    offeredUserCardId: string,
    requestedUserCardId: string,
  ) {
    if (offeredUserCardId === requestedUserCardId) {
      throw new BadRequestException(
        'Não dá para trocar uma carta com ela mesma.',
      );
    }
    const [offered, requested] = await this.prisma.$transaction([
      this.prisma.userCard.findUnique({
        where: { id: offeredUserCardId },
        select: { id: true, userId: true },
      }),
      this.prisma.userCard.findUnique({
        where: { id: requestedUserCardId },
        select: { id: true, userId: true },
      }),
    ]);
    if (!offered)
      throw new NotFoundException('Carta oferecida não encontrada.');
    if (!requested) throw new NotFoundException('Carta pedida não encontrada.');
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

    const [offeredActive, requestedActive, sentByMe, pendingForMe] =
      await this.prisma.$transaction([
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
      ]);
    if (offeredActive > 0 || requestedActive > 0) {
      throw new ConflictException(
        'Uma dessas cartas já está numa troca pendente.',
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
        await tx.gachaTrade.update({
          where: { id: tradeId },
          data: { status: 'EXPIRED' },
        });
        throw new ConflictException('Troca expirada.');
      }

      const [offeredOwner, requestedOwner] = await this.prisma.$transaction([
        tx.userCard.findUnique({
          where: { id: trade.offeredUserCardId },
          select: { userId: true },
        }),
        tx.userCard.findUnique({
          where: { id: trade.requestedUserCardId },
          select: { userId: true },
        }),
      ]);
      if (
        offeredOwner?.userId !== trade.offeredUserId ||
        requestedOwner?.userId !== trade.requestedUserId
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
        data: { featuredUserCardId: null },
      });
      await tx.user.updateMany({
        where: {
          id: trade.requestedUserId,
          featuredUserCardId: trade.requestedUserCard.id,
        },
        data: { featuredUserCardId: null },
      });

      await tx.userCard.updateMany({
        where: { id: trade.offeredUserCard.id },
        data: { userId: trade.requestedUserId },
      });
      await tx.userCard.updateMany({
        where: { id: trade.requestedUserCard.id },
        data: { userId: trade.offeredUserId },
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
        await tx.gachaTrade.update({
          where: { id: tradeId },
          data: { status: 'EXPIRED' },
        });
        throw new ConflictException('Troca expirada.');
      }
      await tx.gachaTrade.update({
        where: { id: tradeId },
        data: { status: 'CANCELLED' },
      });
      return { id: tradeId, status: 'CANCELLED' };
    });
  }

  private async publishPullPost(userId: string, pull: Pull) {
    const privacy = await this.prisma.privacySettings.findUnique({
      where: { userId },
      select: { showGacha: true },
    });
    if (privacy && !privacy.showGacha) return null;

    return this.prisma.post.create({
      data: {
        userId,
        kind: 'GACHA_PULL',
        content: `Tirou ${pull.card.name} — ${pull.card.rarity} ${pull.foil} ${conditionLabel(pull.condition)} #${pull.edition}`,
        animeId: pull.card.animeId,
        meta: {
          userCardId: pull.id,
          cardId: pull.card.id,
          name: pull.card.name,
          image: pull.card.image,
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
