import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { TurnstileService } from '@/auth/turnstile/turnstile.service';
import {
  GACHA_FOIL_WEIGHTS,
  GACHA_PITY_DAYS,
  GACHA_PITY_WEIGHTS,
  GACHA_ROLLS_PER_DAY,
  GACHA_TIER_WEIGHTS,
  GachaTier,
  cardValue,
  conditionLabel,
  isEpicTier,
  pickWeighted,
} from '@/gacha/gacha.constants';

const DAY_MS = 86_400_000;
const EPIC_RARITIES = ['EPICA', 'LENDARIA'];

const PULL_SELECT = {
  id: true,
  condition: true,
  foil: true,
  edition: true,
  value: true,
  obtainedAt: true,
  user: { select: { id: true, name: true, userName: true, avatar: true } },
  waifu: {
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
} satisfies Prisma.UserWaifuSelect;

type Pull = Prisma.UserWaifuGetPayload<{ select: typeof PULL_SELECT }>;

@Injectable()
export class GachaService {
  private readonly logger = new Logger(GachaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly turnstile: TurnstileService,
  ) {}

  // ponytail: dia em UTC; migrar p/ TZ do usuário se houver reclamação BR.
  private dayStartUtc(now = new Date()): Date {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }

  async status(userId: string) {
    const start = this.dayStartUtc();
    const [today, lastEpic, first] = await this.prisma.$transaction([
      this.prisma.gachaRollDay.count({
        where: { userId, day: start },
      }),
      this.prisma.userWaifu.findFirst({
        where: { userId, waifu: { rarity: { in: EPIC_RARITIES } } },
        orderBy: { obtainedAt: 'desc' },
        select: { obtainedAt: true },
      }),
      this.prisma.userWaifu.findFirst({
        where: { userId },
        orderBy: { obtainedAt: 'asc' },
        select: { obtainedAt: true },
      }),
    ]);

    const since = lastEpic?.obtainedAt ?? first?.obtainedAt ?? null;
    const daysSince = since
      ? Math.floor((Date.now() - since.getTime()) / DAY_MS)
      : 0;
    const pityDaysLeft = since
      ? Math.max(0, GACHA_PITY_DAYS - daysSince)
      : GACHA_PITY_DAYS;

    return {
      canRoll: today < GACHA_ROLLS_PER_DAY,
      rollsLeft: Math.max(0, GACHA_ROLLS_PER_DAY - today),
      nextRollAt:
        today < GACHA_ROLLS_PER_DAY
          ? null
          : new Date(start.getTime() + DAY_MS).toISOString(),
      pityDaysLeft,
      pityDue: since !== null && daysSince >= GACHA_PITY_DAYS,
    };
  }

  async roll(userId: string, turnstileToken?: string) {
    await this.turnstile.verify(turnstileToken);

    const state = await this.status(userId);
    if (!state.canRoll) {
      throw new ForbiddenException('Você já fez seu roll hoje. Volte amanhã.');
    }

    const tier = await this.pickTierWithStock(
      state.pityDue ? GACHA_PITY_WEIGHTS : GACHA_TIER_WEIGHTS,
    );
    const poolSize = await this.prisma.waifu.count({
      where: { rarity: tier },
    });
    const waifu = await this.prisma.waifu.findFirst({
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
    if (!waifu) {
      throw new NotFoundException('Pool do gacha vazio. Seed pendente.');
    }

    const condition = Math.random();
    const foil = pickWeighted(GACHA_FOIL_WEIGHTS);

    let pull: Pull;
    try {
      pull = await this.prisma.$transaction(async (tx) => {
        await tx.gachaRollDay.create({
          data: { userId, day: this.dayStartUtc() },
        });
        const counter = await tx.waifu.update({
          where: { id: waifu.id },
          data: { editionCounter: { increment: 1 } },
          select: { editionCounter: true },
        });
        const edition = counter.editionCounter;
        return tx.userWaifu.create({
          data: {
            userId,
            waifuId: waifu.id,
            condition,
            foil,
            edition,
            value: cardValue(tier, condition, foil, edition),
          },
          select: PULL_SELECT,
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ForbiddenException(
          'Você já fez seu roll hoje. Volte amanhã.',
        );
      }
      throw error;
    }

    if (isEpicTier(tier)) {
      // Best-effort pós-commit: falha no post não pode transformar
      // um roll commitado em 500 (caller retry veria 403 confuso).
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
      pityDue: state.pityDue,
    };
  }

  async collection(ownerId: string, viewerId: string, page = 1, limit = 24) {
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
    const [pulls, total, stats] = await this.prisma.$transaction([
      this.prisma.userWaifu.findMany({
        where: { userId: ownerId },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        orderBy: { value: 'desc' },
        select: PULL_SELECT,
      }),
      this.prisma.userWaifu.count({ where: { userId: ownerId } }),
      this.prisma.userWaifu.aggregate({
        where: { userId: ownerId },
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

  async recent(limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const pulls = await this.prisma.userWaifu.findMany({
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
    const sums = await this.prisma.userWaifu.groupBy({
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
      const count = await this.prisma.waifu.count({
        where: { rarity: tier },
      });
      if (count > 0) return tier;
      delete remaining[tier];
    }
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
        content: `Tirou ${pull.waifu.name} — ${pull.waifu.rarity} ${pull.foil} ${conditionLabel(pull.condition)} #${pull.edition}`,
        animeId: pull.waifu.animeId,
        meta: {
          userWaifuId: pull.id,
          waifuId: pull.waifu.id,
          name: pull.waifu.name,
          image: pull.waifu.image,
          rarity: pull.waifu.rarity,
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
