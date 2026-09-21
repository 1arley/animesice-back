import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import {
  BoxTier,
  dateFromDayKey,
  dayKey,
  PrizeCategory,
  PrizeQuality,
  prizeAmount,
  weightedPick,
} from './economy.rules';
import {
  CreateBuyOrderDto,
  MarketQueryDto,
  EconomicEventDto,
  ReviewSaleDto,
} from './economy.dto';
import { economyConfig, EconomyConfig } from './economy.config';

type Tx = Prisma.TransactionClient;

const BOX_FIELD: Record<BoxTier, 'commonBoxes' | 'rareBoxes' | 'premiumBoxes'> =
  {
    COMMON: 'commonBoxes',
    RARE: 'rareBoxes',
    PREMIUM: 'premiumBoxes',
  };

const QUALITY_TIERS: Record<PrizeQuality, string[]> = {
  BASIC: ['COMUM', 'INCOMUM'],
  RARE: ['RARA'],
  EPIC: ['EPICA', 'MITICA'],
  LEGENDARY: ['LENDARIA', 'GALACTICA'],
};

@Injectable()
export class EconomyService {
  constructor(private readonly prisma: PrismaService) {}

  private async currentVersion(tx: Tx) {
    const version = await tx.gachaEconomyVersion.findFirst({
      where: { activeFrom: { lte: new Date() } },
      orderBy: [{ activeFrom: 'desc' }, { version: 'desc' }],
    });
    if (!version) throw new ConflictException('Economia sem versão publicada.');
    return { version, config: economyConfig(version.snapshot) };
  }

  async odds() {
    const { version, config } = await this.currentVersion(this.prisma);
    const [cards, skins, backs] = await Promise.all([
      this.prisma.card.findMany({
        where: {
          status: 'ACTIVE',
          id: { notIn: await this.inactiveEventItems(this.prisma, 'cardIds') },
        },
        select: { id: true, name: true, rarity: true },
      }),
      this.prisma.gachaSkin.findMany({
        where: {
          active: true,
          blocked: false,
          id: { notIn: await this.inactiveEventItems(this.prisma, 'skinIds') },
        },
        select: { id: true, name: true, rarity: true },
      }),
      this.prisma.gachaCardBack.findMany({
        where: {
          status: 'PUBLISHED',
          type: 'BACK',
          key: {
            notIn: await this.inactiveEventItems(this.prisma, 'cardBackKeys'),
          },
        },
        select: { id: true, name: true, key: true, rarity: true },
      }),
    ]);
    const probabilities = (
      rows: { id: string; name: string; rarity: string }[],
      card: boolean,
    ) =>
      Object.entries(QUALITY_TIERS).flatMap(([quality, tiers]) => {
        const pool = rows.filter((item) =>
          card
            ? tiers.includes(item.rarity)
            : item.rarity === (quality === 'BASIC' ? 'COMMON' : quality),
        );
        return pool.map((item) => ({
          ...item,
          quality,
          conditionalProbability: 1 / pool.length,
        }));
      });
    const packages =
      (
        version.snapshot as {
          crystal_packages?: Record<
            string,
            { cents: number; crystals: number }
          >;
        }
      ).crystal_packages ?? {};
    return {
      versionId: version.id,
      version: version.version,
      boxPrices: config.box_prices,
      keyPrice: config.key_price,
      categories: config.box_category_weights,
      qualities: config.box_quality_weights,
      foilWeights: config.foil_weights,
      crystalPackages: Object.entries(packages).map(([id, pack]) => ({
        id,
        ...pack,
      })),
      items: {
        CARD: probabilities(cards, true),
        SKIN: probabilities(skins, false),
        CARD_BACK: probabilities(backs, false),
      },
      cardBackSelection:
        'Uniform among unowned items of the selected quality; complete ownership converts a uniformly selected duplicate to 50% of its official price.',
      loyalty: {
        category: 'CARD',
        qualities: { RARE: 55, EPIC: 35, LEGENDARY: 10 },
      },
    };
  }

  async listings(query: MarketQueryDto, userId?: string) {
    await this.expireMarket();
    const { page, limit, itemType, itemId } = query;
    const where = {
      status: 'ACTIVE' as const,
      expiresAt: { gt: new Date() },
      ...(userId ? { userId } : {}),
    };
    const cardWhere = {
      ...where,
      ...(itemId ? { userCard: { cardId: itemId } } : {}),
    };
    const skinWhere = {
      ...where,
      ...(itemId ? { userSkin: { skinId: itemId } } : {}),
    };
    const [cards, skins, cardCount, skinCount] = await Promise.all([
      itemType === 'SKIN'
        ? []
        : this.prisma.gachaListing.findMany({
            where: cardWhere,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
            select: {
              id: true,
              price: true,
              status: true,
              createdAt: true,
              expiresAt: true,
              userCard: {
                select: {
                  id: true,
                  cardId: true,
                  foil: true,
                  condition: true,
                  edition: true,
                  card: {
                    select: {
                      id: true,
                      name: true,
                      image: true,
                      rarity: true,
                      animeTitle: true,
                    },
                  },
                },
              },
            },
          }),
      itemType === 'CARD'
        ? []
        : this.prisma.gachaSkinListing.findMany({
            where: skinWhere,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
            select: {
              id: true,
              price: true,
              status: true,
              createdAt: true,
              expiresAt: true,
              userSkin: {
                select: {
                  id: true,
                  skinId: true,
                  name: true,
                  imageUrl: true,
                  rarity: true,
                },
              },
            },
          }),
      itemType === 'SKIN'
        ? 0
        : this.prisma.gachaListing.count({ where: cardWhere }),
      itemType === 'CARD'
        ? 0
        : this.prisma.gachaSkinListing.count({ where: skinWhere }),
    ]);
    const items = [
      ...cards.map(({ userCard, ...listing }) => ({
        ...listing,
        itemType: 'CARD',
        item: userCard,
      })),
      ...skins.map(({ userSkin, ...listing }) => ({
        ...listing,
        itemType: 'SKIN',
        item: userSkin,
      })),
    ].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
    return { items, page, limit, total: cardCount + skinCount };
  }

  async orders(query: MarketQueryDto, userId?: string) {
    await this.expireMarket();
    const where: Prisma.GachaBuyOrderWhereInput = {
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      ...(userId ? { userId } : {}),
      ...(query.itemType ? { itemType: query.itemType } : {}),
      ...(query.itemId
        ? { OR: [{ cardId: query.itemId }, { skinId: query.itemId }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.gachaBuyOrder.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ price: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          itemType: true,
          cardId: true,
          skinId: true,
          price: true,
          foil: true,
          condition: true,
          maxEdition: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          card: { select: { id: true, name: true, image: true, rarity: true } },
          skin: {
            select: { id: true, name: true, imageUrl: true, rarity: true },
          },
        },
      }),
      this.prisma.gachaBuyOrder.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  ownedSkins(userId: string) {
    return this.prisma.userGachaSkin.findMany({
      where: { userId, status: 'ACTIVE' },
      select: {
        id: true,
        skinId: true,
        name: true,
        imageUrl: true,
        rarity: true,
        status: true,
      },
      orderBy: { acquiredAt: 'desc' },
    });
  }

  reviewedSales() {
    return this.prisma.gachaMarketSale.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Cron('0 * * * * *', { waitForCompletion: true })
  async expireMarket() {
    return this.prisma.$transaction(async (tx) => {
      await this.expireOrders(tx);
      const [cards, skins] = await Promise.all([
        tx.gachaListing.findMany({
          where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
          select: { id: true, userId: true, userCardId: true },
        }),
        tx.gachaSkinListing.findMany({
          where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
          select: { id: true, userId: true, userSkinId: true },
        }),
      ]);
      for (const listing of cards) {
        const expired = await tx.gachaListing.updateMany({
          where: { id: listing.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED' },
        });
        if (expired.count)
          await tx.userCard.updateMany({
            where: {
              id: listing.userCardId,
              userId: listing.userId,
              status: 'ESCROW',
            },
            data: { status: 'ACTIVE' },
          });
      }
      for (const listing of skins) {
        const expired = await tx.gachaSkinListing.updateMany({
          where: { id: listing.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED' },
        });
        if (expired.count)
          await tx.userGachaSkin.updateMany({
            where: {
              id: listing.userSkinId,
              userId: listing.userId,
              status: 'ESCROW',
            },
            data: { status: 'ACTIVE' },
          });
      }
    });
  }

  private async inactiveEventItems(
    tx: Tx,
    field: 'cardIds' | 'skinIds' | 'cardBackKeys',
  ): Promise<string[]> {
    const { version } = await this.currentVersion(tx);
    const snapshot = version.snapshot as {
      economic_event?: {
        startDay?: number;
        cardIds?: string[];
        skinIds?: string[];
        cardBackKeys?: string[];
      };
    };
    const event = snapshot.economic_event;
    if (!event) return [];
    const day = Number(dayKey().slice(-2));
    return day >= (event.startDay ?? 1) && day < (event.startDay ?? 1) + 7
      ? []
      : (event[field] ?? []);
  }

  async configureEvent(adminId: string, dto: EconomicEventDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const [cards, skins, backs] = await Promise.all([
          tx.card.count({ where: { id: { in: dto.cardIds } } }),
          tx.gachaSkin.count({ where: { id: { in: dto.skinIds } } }),
          tx.gachaCardBack.count({
            where: { key: { in: dto.cardBackKeys }, type: 'BACK' },
          }),
        ]);
        if (
          cards !== dto.cardIds.length ||
          skins !== dto.skinIds.length ||
          backs !== dto.cardBackKeys.length
        )
          throw new BadRequestException('Evento contém item inexistente.');
        const { reason, ...value } = dto;
        await tx.gachaConfig.upsert({
          where: { key: 'economic_event' },
          create: {
            key: 'economic_event',
            label: 'Evento econômico mensal',
            group: 'eventos',
            value,
          },
          update: { value },
        });
        const [rows, latest] = await Promise.all([
          tx.gachaConfig.findMany(),
          tx.gachaEconomyVersion.aggregate({ _max: { version: true } }),
        ]);
        return tx.gachaEconomyVersion.create({
          data: {
            version: (latest._max.version ?? 0) + 1,
            authorId: adminId,
            reason,
            snapshot: Object.fromEntries(
              rows.map((row) => [row.key, row.value]),
            ),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  reviewSale(adminId: string, saleId: string, dto: ReviewSaleDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const before = await tx.gachaMarketSale.findUniqueOrThrow({
          where: { id: saleId },
        });
        const sale = await tx.gachaMarketSale.update({
          where: { id: saleId },
          data: { suspicious: dto.suspicious },
        });
        const blocked: string[] = [];
        if (dto.suspicious && dto.blockRecurring) {
          for (const userId of [sale.sellerId, sale.buyerId]) {
            const count = await tx.gachaMarketSale.count({
              where: {
                suspicious: true,
                OR: [{ sellerId: userId }, { buyerId: userId }],
              },
            });
            if (count >= 3) {
              await tx.user.update({
                where: { id: userId },
                data: {
                  gachaMarketBlockedAt: new Date(),
                  gachaMarketBlockReason: dto.reason,
                },
              });
              blocked.push(userId);
            }
          }
        }
        await tx.gachaAdminChange.create({
          data: {
            adminId,
            action: 'ECONOMY_SALE_REVIEW',
            reason: dto.reason,
            before: { saleId, suspicious: before.suspicious },
            after: { saleId, suspicious: dto.suspicious, blocked },
          },
        });
        return { sale, blocked };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  blockItem(
    adminId: string,
    itemType: 'CARD' | 'SKIN',
    itemId: string,
    reason: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const { config } = await this.currentVersion(tx);
        const orders = await tx.gachaBuyOrder.findMany({
          where: {
            status: 'ACTIVE',
            ...(itemType === 'CARD' ? { cardId: itemId } : { skinId: itemId }),
          },
        });
        for (const order of orders) {
          const cancelled = await tx.gachaBuyOrder.updateMany({
            where: { id: order.id, status: 'ACTIVE' },
            data: { status: 'CANCELLED' },
          });
          if (cancelled.count)
            await tx.user.update({
              where: { id: order.userId },
              data: { crystalReserved: { decrement: order.price } },
            });
        }
        let compensated = 0;
        if (itemType === 'CARD') {
          const card = await tx.card.update({
            where: { id: itemId },
            data: { status: 'ARCHIVED' },
          });
          const copies = await tx.userCard.findMany({
            where: { cardId: itemId, status: { in: ['ACTIVE', 'ESCROW'] } },
          });
          await tx.gachaListing.updateMany({
            where: { userCard: { cardId: itemId }, status: 'ACTIVE' },
            data: { status: 'CANCELLED' },
          });
          await tx.gachaTrade.updateMany({
            where: {
              status: 'PENDING',
              OR: [
                { offeredUserCard: { cardId: itemId } },
                { requestedUserCard: { cardId: itemId } },
                { cards: { some: { userCard: { cardId: itemId } } } },
              ],
            },
            data: { status: 'CANCELLED' },
          });
          await tx.user.updateMany({
            where: {
              featuredUserCardId: { in: copies.map((copy) => copy.id) },
            },
            data: { featuredUserCardId: null },
          });
          for (const copy of copies) {
            const removed = await tx.userCard.updateMany({
              where: { id: copy.id, status: { in: ['ACTIVE', 'ESCROW'] } },
              data: { status: 'REMOVED', skinId: null },
            });
            if (removed.count) {
              await this.credit(
                tx,
                copy.userId,
                config.card_floors[card.rarity] ?? 500,
                'MINT',
                copy.id,
                `Compensação por bloqueio: ${reason}`,
              );
              compensated++;
            }
          }
        } else {
          await tx.gachaSkin.update({
            where: { id: itemId },
            data: { blocked: true, active: false },
          });
          const copies = await tx.userGachaSkin.findMany({
            where: { skinId: itemId, status: { in: ['ACTIVE', 'ESCROW'] } },
          });
          await tx.gachaSkinListing.updateMany({
            where: { userSkin: { skinId: itemId }, status: 'ACTIVE' },
            data: { status: 'CANCELLED' },
          });
          await tx.userCard.updateMany({
            where: { skinId: itemId },
            data: { skinId: null },
          });
          await tx.user.updateMany({
            where: { equippedGachaSkinId: itemId },
            data: { equippedGachaSkinId: null },
          });
          for (const copy of copies) {
            const removed = await tx.userGachaSkin.updateMany({
              where: { id: copy.id, status: { in: ['ACTIVE', 'ESCROW'] } },
              data: { status: 'REMOVED' },
            });
            if (removed.count) {
              await this.credit(
                tx,
                copy.userId,
                config.skin_floors[copy.rarity] ?? 2000,
                'MINT',
                copy.id,
                `Compensação por bloqueio: ${reason}`,
              );
              compensated++;
            }
          }
        }
        await tx.gachaAdminChange.create({
          data: {
            adminId,
            action: 'ECONOMY_ITEM_BLOCK',
            reason,
            after: {
              itemType,
              itemId,
              compensated,
              cancelledOrders: orders.length,
            },
          },
        });
        return { itemType, itemId, compensated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async inventory(userId: string) {
    await this.expireMarket();
    const [user, inventory, retention] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { crystalBalance: true, crystalReserved: true },
      }),
      this.prisma.gachaInventory.upsert({
        where: { userId },
        create: { userId },
        update: {},
      }),
      this.prisma.gachaRetention.upsert({
        where: { userId },
        create: { userId },
        update: {},
      }),
    ]);
    return {
      ...inventory,
      ...retention,
      balance: user.crystalBalance,
      reserved: user.crystalReserved,
      available: user.crystalBalance - user.crystalReserved,
      dailyClaimedToday: !!(await this.prisma.gachaDailyClaim.findUnique({
        where: { userId_day: { userId, day: dateFromDayKey(dayKey()) } },
      })),
    };
  }

  buyKey(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const config = (await this.currentVersion(tx)).config;
      await this.spend(tx, userId, config.key_price, 'Compra de chave', 'key');
      const inventory = await tx.gachaInventory.upsert({
        where: { userId },
        create: { userId, keys: 1 },
        update: { keys: { increment: 1 } },
      });
      return { inventory, price: config.key_price };
    });
  }

  buyBox(userId: string, tier: BoxTier) {
    const field = BOX_FIELD[tier];
    return this.prisma.$transaction(async (tx) => {
      const config = (await this.currentVersion(tx)).config;
      await this.spend(
        tx,
        userId,
        config.box_prices[tier],
        `Compra de caixa ${tier}`,
        tier,
      );
      const inventory = await tx.gachaInventory.upsert({
        where: { userId },
        create: { userId, [field]: 1 },
        update: { [field]: { increment: 1 } },
      });
      return { inventory, price: config.box_prices[tier] };
    });
  }

  async claimDaily(userId: string) {
    const today = dateFromDayKey(dayKey());
    return this.prisma.$transaction(
      async (tx) => {
        const config = (await this.currentVersion(tx)).config;
        try {
          await tx.gachaDailyClaim.create({ data: { userId, day: today } });
        } catch (error) {
          if (this.isUniqueError(error)) {
            throw new ForbiddenException('Bônus diário já resgatado hoje.');
          }
          throw error;
        }
        await this.credit(
          tx,
          userId,
          config.daily_bonus,
          'DAILY',
          dayKey(),
          'Bônus diário',
        );
        const progress = await tx.gachaRetention.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        const afterLastReward = progress.weeklyRewardClaimedAt
          ? { gt: progress.weeklyRewardClaimedAt }
          : undefined;
        const recent = await tx.gachaDailyClaim.findMany({
          where: { userId, day: afterLastReward },
          orderBy: { day: 'desc' },
          take: 10,
          select: { day: true },
        });
        if (recent.length >= 7) {
          const span = recent[0]!.day.getTime() - recent[6]!.day.getTime();
          if (span <= 9 * 86_400_000) {
            await tx.gachaRetention.update({
              where: { userId },
              data: { weeklyRewardReady: true },
            });
          }
        }
        return { claimed: config.daily_bonus, day: dayKey() };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  claimWeekly(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.gachaRetention.updateMany({
        where: { userId, weeklyRewardReady: true },
        data: {
          weeklyRewardReady: false,
          weeklyRewardClaimedAt: dateFromDayKey(dayKey()),
        },
      });
      if (claimed.count !== 1) {
        throw new ForbiddenException('Recompensa semanal indisponível.');
      }
      const inventory = await tx.gachaInventory.upsert({
        where: { userId },
        create: { userId, rareBoxes: 1, keys: 1 },
        update: { rareBoxes: { increment: 1 }, keys: { increment: 1 } },
      });
      return { inventory, reward: { rareBoxes: 1, keys: 1 } };
    });
  }

  openBox(userId: string, tier: BoxTier) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertEconomyEnabled(tx, userId);
        const field = BOX_FIELD[tier];
        const consumed = await tx.gachaInventory.updateMany({
          where: { userId, [field]: { gte: 1 }, keys: { gte: 1 } },
          data: { [field]: { decrement: 1 }, keys: { decrement: 1 } },
        });
        if (consumed.count !== 1) {
          throw new BadRequestException('Caixa ou chave insuficiente.');
        }

        const retention = await tx.gachaRetention.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        const loyaltyGuaranteed = retention.loyaltyRarePlusReady;
        const { version, config } = await this.currentVersion(tx);
        const category = loyaltyGuaranteed
          ? 'CARD'
          : weightedPick(config.box_category_weights[tier]);
        const quality = loyaltyGuaranteed
          ? weightedPick({ RARE: 55, EPIC: 35, LEGENDARY: 10 })
          : weightedPick(config.box_quality_weights[tier]);
        const reward = await this.grantPrize(
          tx,
          userId,
          tier,
          category,
          quality,
          config,
        );
        const opening = await tx.gachaOpening.create({
          data: {
            userId,
            boxTier: tier,
            category,
            quality,
            amount: reward.amount,
            reward: reward.data,
            economyVersionId: version.id,
            loyaltyGuaranteed,
          },
        });
        if (loyaltyGuaranteed) {
          await tx.gachaRetention.update({
            where: { userId },
            data: { loyaltyRarePlusReady: false },
          });
        }
        await this.advanceLoyalty(tx, userId);
        return { opening, reward: reward.data };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async useSpinReset(userId: string) {
    const now = new Date();
    const hour = new Date(now);
    hour.setUTCMinutes(0, 0, 0);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "userId" FROM "GachaInventory" WHERE "userId" = ${userId} FOR UPDATE`;
      const previews = (await this.currentVersion(tx)).config.spins_per_hour;
      const used = await tx.gachaSpin.count({ where: { userId, hour } });
      if (used < previews) {
        throw new BadRequestException(
          'Use o reset somente após esgotar os previews.',
        );
      }
      const consumed = await tx.gachaInventory.updateMany({
        where: { userId, spinResets: { gte: 1 } },
        data: { spinResets: { decrement: 1 } },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException('Reset de giro insuficiente.');
      }
      await tx.gachaSpin.deleteMany({
        where: { userId, hour },
      });
      return { reset: true, previews };
    });
  }

  async createBuyOrder(userId: string, dto: CreateBuyOrderDto) {
    if (
      dto.itemType === 'SKIN' &&
      (dto.foil || dto.condition || dto.maxEdition)
    )
      throw new BadRequestException(
        'Filtros de variante são exclusivos de cartas.',
      );
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMarketEligible(tx, userId);
        await this.expireOrders(tx, userId);
        const active = await tx.gachaBuyOrder.count({
          where: { userId, status: 'ACTIVE' },
        });
        const { config } = await this.currentVersion(tx);
        if (active >= config.buy_order_active_limit)
          throw new BadRequestException('Limite de ordens ativas atingido.');
        if (dto.itemType === 'CARD') {
          const exists = await tx.card.findUnique({
            where: { id: dto.itemId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!exists) throw new NotFoundException('Carta não encontrada.');
        } else {
          const exists = await tx.gachaSkin.findUnique({
            where: { id: dto.itemId, blocked: false },
            select: { id: true },
          });
          if (!exists) throw new NotFoundException('Skin não encontrada.');
        }
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const wallet = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { crystalBalance: true, crystalReserved: true },
        });
        if (wallet.crystalBalance - wallet.crystalReserved < dto.price)
          throw new BadRequestException('Crystal disponível insuficiente.');
        await tx.user.update({
          where: { id: userId },
          data: { crystalReserved: { increment: dto.price } },
        });
        return tx.gachaBuyOrder.create({
          data: {
            userId,
            itemType: dto.itemType,
            cardId: dto.itemType === 'CARD' ? dto.itemId : null,
            skinId: dto.itemType === 'SKIN' ? dto.itemId : null,
            foil: dto.foil,
            condition: dto.condition,
            maxEdition: dto.maxEdition,
            price: dto.price,
            expiresAt: new Date(Date.now() + config.listing_ttl_ms),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  cancelBuyOrder(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.gachaBuyOrder.findFirst({
        where: { id: orderId, userId, status: 'ACTIVE' },
      });
      if (!order) throw new ConflictException('Ordem não está ativa.');
      const cancelled = await tx.gachaBuyOrder.updateMany({
        where: { id: orderId, userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      if (!cancelled.count)
        throw new ConflictException('Ordem não está ativa.');
      await tx.user.update({
        where: { id: userId },
        data: { crystalReserved: { decrement: order.price } },
      });
      return { cancelled: true };
    });
  }

  sellCardNow(userId: string, userCardId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMarketEligible(tx, userId);
        const card = await tx.userCard.findFirst({
          where: { id: userCardId, userId, status: 'ACTIVE' },
          include: { card: true },
        });
        if (!card) throw new NotFoundException('Carta não encontrada.');
        await this.prepareCardForSale(tx, userId, card.id);
        const orders = await tx.gachaBuyOrder.findMany({
          where: {
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
            itemType: 'CARD',
            cardId: card.cardId,
            userId: { not: userId },
            OR: [{ foil: null }, { foil: card.foil }],
            AND: [
              {
                OR: [
                  { maxEdition: null },
                  { maxEdition: { gte: card.edition } },
                ],
              },
            ],
          },
          orderBy: [{ price: 'desc' }, { createdAt: 'asc' }],
        });
        const order = orders.find(
          (candidate) =>
            candidate.condition === null ||
            candidate.condition === this.conditionLabel(card.condition),
        );
        if (!order) throw new NotFoundException('Nenhuma ordem compatível.');
        return this.fillCardOrder(tx, userId, card.id, order);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  sellSkinNow(userId: string, userSkinId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMarketEligible(tx, userId);
        const copy = await tx.userGachaSkin.findFirst({
          where: {
            id: userSkinId,
            userId,
            status: 'ACTIVE',
            skin: { blocked: false },
          },
        });
        if (!copy) throw new NotFoundException('Skin não encontrada.');
        const order = await tx.gachaBuyOrder.findFirst({
          where: {
            status: 'ACTIVE',
            itemType: 'SKIN',
            skinId: copy.skinId,
            userId: { not: userId },
            expiresAt: { gt: new Date() },
          },
          orderBy: [{ price: 'desc' }, { createdAt: 'asc' }],
        });
        if (!order) throw new NotFoundException('Nenhuma ordem compatível.');
        await tx.userCard.updateMany({
          where: { userId, skinId: copy.skinId },
          data: { skinId: null },
        });
        await tx.user.updateMany({
          where: { id: userId, equippedGachaSkinId: copy.skinId },
          data: { equippedGachaSkinId: null },
        });
        return this.fillSkinOrder(tx, userId, copy.id, order);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  createCardListing(userId: string, userCardId: string, price: number) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMarketEligible(tx, userId);
        await this.assertListingLimit(tx, userId);
        const card = await tx.userCard.findFirst({
          where: { id: userCardId, userId, status: 'ACTIVE' },
          include: { card: true },
        });
        if (!card) throw new NotFoundException('Carta não encontrada.');
        await this.prepareCardForSale(tx, userId, card.id);
        const orders = await tx.gachaBuyOrder.findMany({
          where: {
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
            itemType: 'CARD',
            cardId: card.cardId,
            userId: { not: userId },
            price: { gte: price },
            OR: [{ foil: null }, { foil: card.foil }],
            AND: [
              {
                OR: [
                  { maxEdition: null },
                  { maxEdition: { gte: card.edition } },
                ],
              },
            ],
          },
          orderBy: [{ price: 'desc' }, { createdAt: 'asc' }],
        });
        const order = orders.find(
          (candidate) =>
            candidate.condition === null ||
            candidate.condition === this.conditionLabel(card.condition),
        );
        if (order) {
          return this.fillCardOrder(tx, userId, userCardId, order);
        }
        const moved = await tx.userCard.updateMany({
          where: { id: userCardId, userId, status: 'ACTIVE' },
          data: { status: 'ESCROW' },
        });
        if (moved.count !== 1)
          throw new ConflictException('Carta não está disponível.');
        return tx.gachaListing.create({
          data: {
            userId,
            userCardId,
            price,
            expiresAt: new Date(
              Date.now() +
                (await this.currentVersion(tx)).config.listing_ttl_ms,
            ),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async buyCardListing(userId: string, listingId: string) {
    await this.expireMarket();
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMarketEligible(tx, userId);
        const listing = await tx.gachaListing.findUnique({
          where: { id: listingId },
          include: { userCard: true },
        });
        if (!listing || listing.status !== 'ACTIVE') {
          throw new ConflictException('Anúncio não está ativo.');
        }
        if (listing.userId === userId)
          throw new BadRequestException(
            'Você não pode comprar o próprio anúncio.',
          );
        if (listing.expiresAt <= new Date()) {
          throw new ConflictException('Anúncio expirado.');
        }
        await this.assertMarketEligible(tx, listing.userId);
        await this.spend(
          tx,
          userId,
          listing.price,
          'Compra no mercado',
          listing.id,
        );
        const sold = await tx.gachaListing.updateMany({
          where: { id: listing.id, status: 'ACTIVE' },
          data: { status: 'SOLD', buyerId: userId, completedAt: new Date() },
        });
        if (sold.count !== 1)
          throw new ConflictException('Anúncio não está mais ativo.');
        await tx.userCard.update({
          where: { id: listing.userCardId },
          data: { userId, status: 'ACTIVE' },
        });
        const fee = Math.round(
          listing.price * (await this.currentVersion(tx)).config.market_tax_pct,
        );
        await this.credit(
          tx,
          listing.userId,
          listing.price - fee,
          'SALE',
          listing.id,
          'Venda no mercado',
        );
        const sale = await tx.gachaMarketSale.create({
          data: {
            sellerId: listing.userId,
            buyerId: userId,
            itemType: 'CARD',
            userCardId: listing.userCardId,
            price: listing.price,
            fee,
            variant: {
              foil: listing.userCard.foil,
              condition: listing.userCard.condition,
              edition: listing.userCard.edition,
            },
          },
        });
        await this.notifySale(tx, listing.userId, listing.price - fee, sale.id);
        return { saleId: sale.id, price: listing.price, fee };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  cancelCardListing(userId: string, listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.gachaListing.findFirst({
        where: { id: listingId, userId, status: 'ACTIVE' },
      });
      if (!listing) throw new ConflictException('Anúncio não está ativo.');
      const cancelled = await tx.gachaListing.updateMany({
        where: { id: listing.id, userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      if (!cancelled.count)
        throw new ConflictException('Anúncio não está ativo.');
      await tx.userCard.updateMany({
        where: { id: listing.userCardId, userId, status: 'ESCROW' },
        data: { status: 'ACTIVE' },
      });
      return { cancelled: true };
    });
  }

  createSkinListing(userId: string, userSkinId: string, price: number) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMarketEligible(tx, userId);
        await this.assertListingLimit(tx, userId);
        const copy = await tx.userGachaSkin.findFirst({
          where: { id: userSkinId, userId, status: 'ACTIVE' },
        });
        if (!copy) throw new NotFoundException('Cópia de skin não encontrada.');
        const skin = await tx.gachaSkin.findUniqueOrThrow({
          where: { id: copy.skinId },
        });
        if (skin.blocked) throw new ConflictException('Skin bloqueada.');
        const order = await tx.gachaBuyOrder.findFirst({
          where: {
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
            itemType: 'SKIN',
            skinId: copy.skinId,
            userId: { not: userId },
            price: { gte: price },
          },
          orderBy: [{ price: 'desc' }, { createdAt: 'asc' }],
        });
        await tx.userCard.updateMany({
          where: { userId, skinId: copy.skinId },
          data: { skinId: null },
        });
        await tx.user.updateMany({
          where: { id: userId, equippedGachaSkinId: copy.skinId },
          data: { equippedGachaSkinId: null },
        });
        if (order) return this.fillSkinOrder(tx, userId, copy.id, order);
        const moved = await tx.userGachaSkin.updateMany({
          where: { id: copy.id, userId, status: 'ACTIVE' },
          data: { status: 'ESCROW' },
        });
        if (moved.count !== 1)
          throw new ConflictException('Skin não está disponível.');
        return tx.gachaSkinListing.create({
          data: {
            userId,
            userSkinId: copy.id,
            price,
            expiresAt: new Date(
              Date.now() +
                (await this.currentVersion(tx)).config.listing_ttl_ms,
            ),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async buySkinListing(userId: string, listingId: string) {
    await this.expireMarket();
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMarketEligible(tx, userId);
        const listing = await tx.gachaSkinListing.findUnique({
          where: { id: listingId },
        });
        if (!listing || listing.status !== 'ACTIVE')
          throw new ConflictException('Anúncio não está ativo.');
        if (listing.userId === userId)
          throw new BadRequestException(
            'Você não pode comprar o próprio anúncio.',
          );
        if (listing.expiresAt <= new Date()) {
          throw new ConflictException('Anúncio expirado.');
        }
        await this.assertMarketEligible(tx, listing.userId);
        await this.spend(
          tx,
          userId,
          listing.price,
          'Compra de skin no mercado',
          listing.id,
        );
        const sold = await tx.gachaSkinListing.updateMany({
          where: { id: listing.id, status: 'ACTIVE' },
          data: { status: 'FILLED', buyerId: userId, completedAt: new Date() },
        });
        if (sold.count !== 1)
          throw new ConflictException('Anúncio não está mais ativo.');
        await tx.userGachaSkin.update({
          where: { id: listing.userSkinId },
          data: { userId, status: 'ACTIVE' },
        });
        const fee = Math.round(
          listing.price * (await this.currentVersion(tx)).config.market_tax_pct,
        );
        await this.credit(
          tx,
          listing.userId,
          listing.price - fee,
          'SALE',
          listing.id,
          'Venda de skin',
        );
        const sale = await tx.gachaMarketSale.create({
          data: {
            sellerId: listing.userId,
            buyerId: userId,
            itemType: 'SKIN',
            userSkinId: listing.userSkinId,
            price: listing.price,
            fee,
          },
        });
        await this.notifySale(tx, listing.userId, listing.price - fee, sale.id);
        return { saleId: sale.id, price: listing.price, fee };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  cancelSkinListing(userId: string, listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.gachaSkinListing.findFirst({
        where: { id: listingId, userId, status: 'ACTIVE' },
      });
      if (!listing) throw new ConflictException('Anúncio não está ativo.');
      const cancelled = await tx.gachaSkinListing.updateMany({
        where: { id: listing.id, userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      if (!cancelled.count)
        throw new ConflictException('Anúncio não está ativo.');
      await tx.userGachaSkin.updateMany({
        where: { id: listing.userSkinId, userId, status: 'ESCROW' },
        data: { status: 'ACTIVE' },
      });
      return { cancelled: true };
    });
  }

  async marketHistory(
    itemType: 'CARD' | 'SKIN',
    itemId: string,
    variant?: { foil?: string; condition?: string },
  ) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const sales = await this.prisma.gachaMarketSale.findMany({
      where: {
        itemType,
        official: false,
        suspicious: false,
        createdAt: { gte: since },
        ...(itemType === 'CARD'
          ? { userCard: { cardId: itemId } }
          : { userSkin: { skinId: itemId } }),
      },
      orderBy: { price: 'asc' },
      select: {
        price: true,
        variant: true,
        userCard: { select: { foil: true, condition: true } },
      },
    });
    const specific =
      itemType === 'CARD' && variant && (variant.foil || variant.condition)
        ? sales.filter((sale) => {
            const sold = (sale.variant ?? sale.userCard) as {
              foil: string;
              condition: number;
            } | null;
            return (
              sold &&
              (!variant.foil || sold.foil === variant.foil) &&
              (!variant.condition ||
                this.conditionLabel(sold.condition) === variant.condition)
            );
          })
        : [];
    // ponytail: five sales support a variant median; use card-wide history below that sample.
    const rows = specific.length >= 5 ? specific : sales;
    if (rows.length === 0)
      return { median: null, min: null, max: null, volume: 0 };
    const middle = Math.floor(rows.length / 2);
    const median =
      rows.length % 2
        ? rows[middle]!.price
        : Math.round((rows[middle - 1]!.price + rows[middle]!.price) / 2);
    return {
      median,
      min: rows[0]!.price,
      max: rows[rows.length - 1]!.price,
      volume: rows.length,
      scope: specific.length >= 5 ? 'VARIANT' : 'ITEM',
    };
  }

  async visitMarket(userId: string) {
    await this.assertMarketEligible(this.prisma, userId);
    await this.prisma.gachaMarketVisit.createMany({
      data: { userId, day: dateFromDayKey(dayKey()) },
      skipDuplicates: true,
    });
    return this.marketMission(userId);
  }

  async marketMission(userId: string) {
    await this.assertMarketEligible(this.prisma, userId);
    const periodStart = this.weekStart();
    const now = new Date();
    const mission = await this.prisma.gachaMarketMission.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      create: { userId, periodStart },
      update: {},
    });
    const [visits, oldCardListing, oldSkinListing] = await Promise.all([
      this.prisma.gachaMarketVisit.count({
        where: { userId, day: { gte: periodStart } },
      }),
      this.prisma.gachaListing.findFirst({
        where: {
          userId,
          createdAt: {
            gte: periodStart,
            lte: new Date(now.getTime() - 86_400_000),
          },
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        select: { id: true },
      }),
      this.prisma.gachaSkinListing.findFirst({
        where: {
          userId,
          createdAt: {
            gte: periodStart,
            lte: new Date(now.getTime() - 86_400_000),
          },
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        select: { id: true },
      }),
    ]);
    const listingQualified =
      mission.listingQualifiedAt !== null ||
      oldCardListing !== null ||
      oldSkinListing !== null;
    if (listingQualified && mission.listingQualifiedAt === null) {
      await this.prisma.gachaMarketMission.update({
        where: { userId_periodStart: { userId, periodStart } },
        data: { listingQualifiedAt: now },
      });
    }
    return {
      periodStart: dayKey(periodStart),
      visits,
      listingQualified,
      ready: visits >= 3 && listingQualified && mission.claimedAt === null,
      claimedAt: mission.claimedAt,
    };
  }

  async claimMarketMission(userId: string) {
    const state = await this.marketMission(userId);
    if (!state.ready)
      throw new ForbiddenException('Missão semanal incompleta.');
    const periodStart = this.weekStart();
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.gachaMarketMission.updateMany({
        where: {
          userId,
          periodStart,
          claimedAt: null,
          listingQualifiedAt: { not: null },
        },
        data: { claimedAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new ConflictException('Missão já resgatada.');
      const inventory = await tx.gachaInventory.upsert({
        where: { userId },
        create: { userId, keys: 1 },
        update: { keys: { increment: 1 } },
      });
      return { reward: { keys: 1 }, inventory };
    });
  }

  async officialShop(userId: string) {
    await this.assertMarketEligible(this.prisma, userId);
    const day = dateFromDayKey(dayKey());
    const nightDay = await this.nightMarketDay();
    const daily = await this.prisma.gachaOfficialOffer.count({
      where: { userId, day, slot: { lt: 7 } },
    });
    if (!daily) await this.generateOfficialOffers(userId, day);
    if (
      nightDay &&
      !(await this.prisma.gachaOfficialOffer.count({
        where: { userId, day: nightDay, slot: { gte: 7 } },
      }))
    )
      await this.generateNightOffers(userId, nightDay);
    return this.prisma.gachaOfficialOffer.findMany({
      where: {
        userId,
        OR: [
          { day, slot: { lt: 7 } },
          ...(nightDay ? [{ day: nightDay, slot: { gte: 7 } }] : []),
        ],
      },
      orderBy: { slot: 'asc' },
      include: { card: true, skin: true },
    });
  }

  buyOfficialOffer(userId: string, offerId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertMarketEligible(tx, userId);
        const offer = await tx.gachaOfficialOffer.findFirst({
          where: {
            id: offerId,
            userId,
            purchasedAt: null,
          },
          include: { card: true, skin: true },
        });
        if (!offer) throw new ConflictException('Oferta indisponível.');
        const validDay =
          offer.slot < 7
            ? dateFromDayKey(dayKey())
            : await this.nightMarketDay();
        if (!validDay || dayKey(offer.day) !== dayKey(validDay))
          throw new ConflictException('Oferta expirada.');
        if (
          (offer.card && offer.card.status !== 'ACTIVE') ||
          (offer.skin && offer.skin.blocked)
        )
          throw new ConflictException('Item bloqueado.');
        await this.spend(
          tx,
          userId,
          offer.price,
          'Compra na loja oficial',
          offer.id,
        );
        const reward = await this.grantOfficialOffer(tx, userId, offer);
        const bought = await tx.gachaOfficialOffer.updateMany({
          where: { id: offer.id, purchasedAt: null },
          data: { purchasedAt: new Date() },
        });
        if (bought.count !== 1)
          throw new ConflictException('Oferta já comprada.');
        return { offerId, reward };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async grantPrize(
    tx: Tx,
    userId: string,
    tier: BoxTier,
    category: PrizeCategory,
    quality: PrizeQuality,
    config: EconomyConfig,
  ): Promise<{ amount: number; data: Prisma.InputJsonValue }> {
    const amount =
      category === 'CRYSTAL'
        ? Math.round(
            (config.box_prices[tier] + config.key_price) *
              { BASIC: 0.2, RARE: 0.3, EPIC: 0.4, LEGENDARY: 0.5 }[quality],
          )
        : prizeAmount(category, tier, quality);
    if (category === 'CRYSTAL') {
      await this.credit(
        tx,
        userId,
        amount,
        'MINT',
        null,
        `Prêmio de caixa ${tier}`,
      );
      return { amount, data: { category, amount } };
    }
    if (category === 'KEY' || category === 'SPIN_RESET') {
      const field = category === 'KEY' ? 'keys' : 'spinResets';
      await tx.gachaInventory.upsert({
        where: { userId },
        create: { userId, [field]: amount },
        update: { [field]: { increment: amount } },
      });
      return { amount, data: { category, amount } };
    }
    if (category === 'CARD') {
      const card = await this.mintCard(tx, userId, quality, config);
      return { amount: 1, data: { category, ...card } };
    }
    if (category === 'SKIN') {
      const skin = await this.mintSkin(tx, userId, quality);
      return { amount: 1, data: { category, ...skin } };
    }
    const cardBack = await this.grantCardBack(tx, userId, quality);
    return { amount: 1, data: { category, ...cardBack } };
  }

  private async mintCard(
    tx: Tx,
    userId: string,
    quality: PrizeQuality,
    config: EconomyConfig,
  ) {
    const candidates = await tx.card.findMany({
      where: {
        status: 'ACTIVE',
        rarity: { in: QUALITY_TIERS[quality] },
        id: { notIn: await this.inactiveEventItems(tx, 'cardIds') },
      },
      select: { id: true, name: true },
    });
    const cardSeed = this.seededRandom(`mint-card:${userId}:${Date.now()}`);
    const card = candidates[Math.floor(cardSeed * candidates.length)];
    if (!card) throw new ConflictException('Pool de cartas sem item elegível.');
    const counter = await tx.card.update({
      where: { id: card.id },
      data: { editionCounter: { increment: 1 } },
      select: { editionCounter: true, rarity: true },
    });
    const foil = weightedPick(config.foil_weights);
    const condition = Number(
      this.seededRandom(`mint-condition:${userId}:${Date.now()}`).toFixed(4),
    );
    const copy = await tx.userCard.create({
      data: {
        userId,
        originalUserId: userId,
        cardId: card.id,
        condition,
        foil,
        edition: counter.editionCounter,
        value: 0,
      },
    });
    await tx.gachaCardDiscovery.createMany({
      data: { userId, cardId: card.id },
      skipDuplicates: true,
    });
    return {
      userCardId: copy.id,
      cardId: card.id,
      name: card.name,
      foil,
      condition,
    };
  }

  private async mintSkin(tx: Tx, userId: string, quality: PrizeQuality) {
    const skins = await tx.gachaSkin.findMany({
      where: {
        active: true,
        blocked: false,
        rarity: quality === 'BASIC' ? 'COMMON' : quality,
        id: { notIn: await this.inactiveEventItems(tx, 'skinIds') },
      },
    });
    const skinSeed = this.seededRandom(`mint-skin:${userId}:${Date.now()}`);
    const skin = skins[Math.floor(skinSeed * skins.length)];
    if (!skin) throw new ConflictException('Pool de skins vazio.');
    const copy = await tx.userGachaSkin.create({
      data: {
        userId,
        skinId: skin.id,
        name: skin.name,
        imageUrl: skin.imageUrl,
        rarity: quality === 'BASIC' ? 'COMMON' : quality,
      },
    });
    return { userSkinId: copy.id, skinId: skin.id, name: skin.name };
  }

  private async grantCardBack(tx: Tx, userId: string, quality: PrizeQuality) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { gachaCosmetics: true },
    });
    const available = await tx.gachaCardBack.findMany({
      where: {
        status: 'PUBLISHED',
        type: 'BACK',
        rarity: quality === 'BASIC' ? 'COMMON' : quality,
        key: {
          notIn: [
            ...user.gachaCosmetics,
            ...(await this.inactiveEventItems(tx, 'cardBackKeys')),
          ],
        },
      },
      orderBy: { key: 'asc' },
    });
    const itemSeed = this.seededRandom(`grant-back:${userId}:${Date.now()}`);
    const item = available[Math.floor(itemSeed * available.length)];
    if (item) {
      await tx.user.update({
        where: { id: userId },
        data: { gachaCosmetics: { push: item.key } },
      });
      return { key: item.key, name: item.name };
    }
    const duplicates = await tx.gachaCardBack.findMany({
      where: {
        status: 'PUBLISHED',
        type: 'BACK',
        rarity: quality === 'BASIC' ? 'COMMON' : quality,
        key: { notIn: await this.inactiveEventItems(tx, 'cardBackKeys') },
      },
    });
    const fallbackSeed = this.seededRandom(
      `grant-back-dup:${userId}:${Date.now()}`,
    );
    const fallback = duplicates[Math.floor(fallbackSeed * duplicates.length)];
    if (!fallback) throw new ConflictException('Pool de capas vazio.');
    const crystals = Math.floor(fallback.price / 2);
    if (crystals > 0) {
      await this.credit(
        tx,
        userId,
        crystals,
        'MINT',
        fallback.key,
        'Capa duplicada',
      );
    }
    return { duplicate: true, crystals };
  }

  private async advanceLoyalty(tx: Tx, userId: string) {
    const day = dateFromDayKey(dayKey());
    const inserted = await tx.gachaOpeningDay.createMany({
      data: { userId, day },
      skipDuplicates: true,
    });
    if (inserted.count === 0) return;
    const progress = await tx.gachaRetention.update({
      where: { userId },
      data: { loyaltyDays: { increment: 1 } },
    });
    if (progress.loyaltyDays >= 10) {
      await tx.gachaRetention.update({
        where: { userId },
        data: { loyaltyDays: 0, loyaltyRarePlusReady: true },
      });
    }
  }

  private async fillCardOrder(
    tx: Tx,
    sellerId: string,
    userCardId: string,
    order: { id: string; userId: string; price: number },
  ) {
    await this.assertMarketEligible(tx, order.userId);
    const filled = await tx.gachaBuyOrder.updateMany({
      where: { id: order.id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      data: { status: 'FILLED', completedAt: new Date() },
    });
    if (filled.count !== 1)
      throw new ConflictException('Ordem não está mais ativa.');
    const moved = await tx.userCard.updateMany({
      where: { id: userCardId, userId: sellerId, status: 'ACTIVE' },
      data: { userId: order.userId, status: 'ACTIVE' },
    });
    if (moved.count !== 1)
      throw new ConflictException('Carta não está disponível.');
    await tx.user.update({
      where: { id: order.userId },
      data: {
        crystalBalance: { decrement: order.price },
        crystalReserved: { decrement: order.price },
      },
    });
    await tx.crystalEvent.create({
      data: {
        userId: order.userId,
        delta: -order.price,
        type: 'PURCHASE',
        refId: order.id,
        reason: 'Ordem de compra executada',
      },
    });
    const fee = Math.round(
      order.price * (await this.currentVersion(tx)).config.market_tax_pct,
    );
    await this.credit(
      tx,
      sellerId,
      order.price - fee,
      'SALE',
      order.id,
      'Venda imediata',
    );
    const sale = await tx.gachaMarketSale.create({
      data: {
        sellerId,
        buyerId: order.userId,
        itemType: 'CARD',
        variant: await tx.userCard.findUniqueOrThrow({
          where: { id: userCardId },
          select: { foil: true, condition: true, edition: true },
        }),
        userCardId,
        buyOrderId: order.id,
        price: order.price,
        fee,
      },
    });
    await this.notifySale(tx, sellerId, order.price - fee, sale.id);
    return { saleId: sale.id, price: order.price, fee };
  }

  private async fillSkinOrder(
    tx: Tx,
    sellerId: string,
    userSkinId: string,
    order: { id: string; userId: string; price: number },
  ) {
    await this.assertMarketEligible(tx, order.userId);
    const filled = await tx.gachaBuyOrder.updateMany({
      where: { id: order.id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      data: { status: 'FILLED', completedAt: new Date() },
    });
    if (filled.count !== 1)
      throw new ConflictException('Ordem não está mais ativa.');
    const moved = await tx.userGachaSkin.updateMany({
      where: { id: userSkinId, userId: sellerId, status: 'ACTIVE' },
      data: { userId: order.userId, status: 'ACTIVE' },
    });
    if (moved.count !== 1)
      throw new ConflictException('Skin não está disponível.');
    await tx.user.update({
      where: { id: order.userId },
      data: {
        crystalBalance: { decrement: order.price },
        crystalReserved: { decrement: order.price },
      },
    });
    await tx.crystalEvent.create({
      data: {
        userId: order.userId,
        delta: -order.price,
        type: 'PURCHASE',
        refId: order.id,
        reason: 'Ordem de skin executada',
      },
    });
    const fee = Math.round(
      order.price * (await this.currentVersion(tx)).config.market_tax_pct,
    );
    await this.credit(
      tx,
      sellerId,
      order.price - fee,
      'SALE',
      order.id,
      'Venda imediata de skin',
    );
    const sale = await tx.gachaMarketSale.create({
      data: {
        sellerId,
        buyerId: order.userId,
        itemType: 'SKIN',
        userSkinId,
        buyOrderId: order.id,
        price: order.price,
        fee,
      },
    });
    await this.notifySale(tx, sellerId, order.price - fee, sale.id);
    return { saleId: sale.id, price: order.price, fee };
  }

  private async notifySale(
    tx: Tx,
    sellerId: string,
    proceeds: number,
    saleId: string,
  ) {
    await tx.notification.create({
      data: {
        userId: sellerId,
        type: 'SYSTEM',
        title: 'Item vendido',
        body: `Você recebeu ${proceeds} Crystals após a taxa do mercado.`,
        linkUrl: '/gacha/market',
        targetId: saleId,
      },
    });
  }

  private async assertListingLimit(tx: Tx, userId: string) {
    const [cards, skins] = await Promise.all([
      tx.gachaListing.count({
        where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      }),
      tx.gachaSkinListing.count({
        where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      }),
    ]);
    if (
      cards + skins >=
      (await this.currentVersion(tx)).config.listing_active_limit
    ) {
      throw new BadRequestException('Limite de anúncios ativos atingido.');
    }
  }

  private async generateOfficialOffers(userId: string, day: Date) {
    const { config } = await this.currentVersion(this.prisma);
    const [cards, ownedCards] = await Promise.all([
      this.prisma.card.findMany({
        where: {
          status: 'ACTIVE',
          id: { notIn: await this.inactiveEventItems(this.prisma, 'cardIds') },
        },
      }),
      this.prisma.userCard.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { cardId: true },
      }),
    ]);
    const selectedCards = this.selectOfficialCards(
      cards,
      `${userId}:${dayKey(day)}:cards`,
      config,
    );
    const ownedIds = [...new Set(ownedCards.map((item) => item.cardId))];
    const skins = await this.prisma.gachaSkin.findMany({
      where: {
        active: true,
        blocked: false,
        cardId: { in: ownedIds },
        id: { notIn: await this.inactiveEventItems(this.prisma, 'skinIds') },
      },
    });
    const selectedSkins = this.stableOrder(
      skins,
      `${userId}:${dayKey(day)}:skins`,
    ).slice(0, 3);
    const data: Prisma.GachaOfficialOfferCreateManyInput[] = [];
    for (const [index, card] of selectedCards.entries()) {
      const foil = weightedPick(
        config.foil_weights,
        this.seededRandom(`${userId}:${dayKey(day)}:${index}:foil`),
      );
      const condition = Number(
        this.seededRandom(
          `${userId}:${dayKey(day)}:${index}:condition`,
        ).toFixed(4),
      );
      const history = await this.marketHistory('CARD', card.id, {
        foil,
        condition: this.conditionLabel(condition),
      });
      const floor = config.card_floors[card.rarity] ?? 500;
      data.push({
        userId,
        day,
        slot: index,
        itemType: 'CARD',
        cardId: card.id,
        price: Math.max(
          floor,
          Math.ceil((history.median ?? 0) * config.official_price_markup),
        ),
        payload: {
          foil,
          condition,
        },
      });
    }
    for (let index = 0; index < 3; index += 1) {
      const skin = selectedSkins[index];
      if (skin) {
        const history = await this.marketHistory('SKIN', skin.id);
        data.push({
          userId,
          day,
          slot: 4 + index,
          itemType: 'SKIN',
          skinId: skin.id,
          price: Math.max(
            config.skin_floors[skin.rarity] ?? 2000,
            Math.ceil((history.median ?? 0) * config.official_price_markup),
          ),
        });
      } else {
        data.push({
          userId,
          day,
          slot: 4 + index,
          itemType: index === selectedSkins.length ? 'KEY' : 'COMMON_BOX',
          price:
            index === selectedSkins.length
              ? config.key_price
              : config.box_prices.COMMON,
        });
      }
    }
    await this.prisma.gachaOfficialOffer.createMany({
      data,
      skipDuplicates: true,
    });
  }

  private async generateNightOffers(userId: string, day: Date) {
    const { config } = await this.currentVersion(this.prisma);
    const [cards, skins] = await Promise.all([
      this.prisma.card.findMany({
        where: {
          status: 'ACTIVE',
          id: { notIn: await this.inactiveEventItems(this.prisma, 'cardIds') },
        },
      }),
      this.prisma.gachaSkin.findMany({
        where: {
          active: true,
          blocked: false,
          id: { notIn: await this.inactiveEventItems(this.prisma, 'skinIds') },
        },
      }),
    ]);
    const seed = `${userId}:${dayKey(day)}:night`;
    const cardOffers = this.selectOfficialCards(cards, seed, config).slice(
      0,
      3,
    );
    const skinOffers = this.stableOrder(skins, `${seed}:skins`).slice(0, 3);
    const data: Prisma.GachaOfficialOfferCreateManyInput[] = [];
    for (const [index, card] of cardOffers.entries()) {
      const foil = weightedPick(
        config.foil_weights,
        this.seededRandom(`${seed}:foil:${index}`),
      );
      const condition = Number(
        this.seededRandom(`${seed}:condition:${index}`).toFixed(4),
      );
      const history = await this.marketHistory('CARD', card.id, {
        foil,
        condition: this.conditionLabel(condition),
      });
      const discount =
        10 + Math.floor(this.seededRandom(`${seed}:${index}`) * 21);
      data.push({
        userId,
        day,
        slot: 7 + index,
        itemType: 'CARD',
        cardId: card.id,
        discount,
        price: Math.floor(
          (Math.max(
            config.card_floors[card.rarity] ?? 500,
            Math.ceil((history.median ?? 0) * config.official_price_markup),
          ) *
            (100 - discount)) /
            100,
        ),
        payload: {
          foil,
          condition,
        },
      });
    }
    for (const [index, skin] of skinOffers.entries()) {
      const history = await this.marketHistory('SKIN', skin.id);
      const discount =
        10 + Math.floor(this.seededRandom(`${seed}:skin:${index}`) * 21);
      data.push({
        userId,
        day,
        slot: 10 + index,
        itemType: 'SKIN',
        skinId: skin.id,
        discount,
        price: Math.floor(
          (Math.max(
            config.skin_floors[skin.rarity] ?? 2000,
            Math.ceil((history.median ?? 0) * config.official_price_markup),
          ) *
            (100 - discount)) /
            100,
        ),
      });
    }
    for (let slot = 7; slot < 13; slot++) {
      if (data.some((offer) => offer.slot === slot)) continue;
      const discount =
        10 + Math.floor(this.seededRandom(`${seed}:fallback:${slot}`) * 21);
      const itemType = slot % 2 ? 'KEY' : 'COMMON_BOX';
      const price =
        itemType === 'KEY' ? config.key_price : config.box_prices.COMMON;
      data.push({
        userId,
        day,
        slot,
        itemType,
        discount,
        price: Math.floor((price * (100 - discount)) / 100),
      });
    }
    await this.prisma.gachaOfficialOffer.createMany({
      data,
      skipDuplicates: true,
    });
  }

  private async grantOfficialOffer(
    tx: Tx,
    userId: string,
    offer: {
      itemType: 'CARD' | 'SKIN' | 'KEY' | 'COMMON_BOX';
      cardId: string | null;
      skinId: string | null;
      payload: Prisma.JsonValue;
      card: { id: string; name: string } | null;
      skin: {
        id: string;
        name: string;
        imageUrl: string;
        rarity: string;
      } | null;
    },
  ) {
    if (offer.itemType === 'KEY' || offer.itemType === 'COMMON_BOX') {
      const field = offer.itemType === 'KEY' ? 'keys' : 'commonBoxes';
      await tx.gachaInventory.upsert({
        where: { userId },
        create: { userId, [field]: 1 },
        update: { [field]: { increment: 1 } },
      });
      return { type: offer.itemType };
    }
    if (offer.itemType === 'SKIN' && offer.skin) {
      const copy = await tx.userGachaSkin.create({
        data: {
          userId,
          skinId: offer.skin.id,
          name: offer.skin.name,
          imageUrl: offer.skin.imageUrl,
          rarity: offer.skin.rarity,
        },
      });
      return { type: 'SKIN', userSkinId: copy.id };
    }
    if (!offer.card)
      throw new ConflictException('Carta da oferta indisponível.');
    const payload = (offer.payload ?? {}) as {
      foil?: string;
      condition?: number;
    };
    const counter = await tx.card.update({
      where: { id: offer.card.id },
      data: { editionCounter: { increment: 1 } },
      select: { editionCounter: true },
    });
    const copy = await tx.userCard.create({
      data: {
        userId,
        originalUserId: userId,
        cardId: offer.card.id,
        condition: payload.condition ?? 0.5,
        foil: payload.foil ?? 'NORMAL',
        edition: counter.editionCounter,
        value: 0,
      },
    });
    return { type: 'CARD', userCardId: copy.id };
  }

  private stableOrder<T extends { id: string }>(items: T[], seed: string): T[] {
    return [...items].sort((left, right) =>
      createHash('sha256')
        .update(`${seed}:${left.id}`)
        .digest('hex')
        .localeCompare(
          createHash('sha256').update(`${seed}:${right.id}`).digest('hex'),
        ),
    );
  }

  private selectOfficialCards<T extends { id: string; rarity: string }>(
    cards: T[],
    seed: string,
    config: EconomyConfig,
  ): T[] {
    const selected: T[] = [];
    const weights = config.tier_weights;
    for (let slot = 0; slot < 4; slot += 1) {
      const rarity = weightedPick(
        weights,
        this.seededRandom(`${seed}:${slot}`),
      );
      const pool = cards.filter(
        (card) =>
          card.rarity === rarity &&
          !selected.some((selectedCard) => selectedCard.id === card.id),
      );
      const fallback = cards.filter(
        (card) => !selected.some((selectedCard) => selectedCard.id === card.id),
      );
      const candidates =
        pool.length > 0 ? pool : fallback.length ? fallback : cards;
      const card = this.stableOrder(candidates, `${seed}:${slot}:item`)[0];
      if (card) selected.push(card);
    }
    return selected;
  }

  private seededRandom(seed: string): number {
    return (
      createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000
    );
  }

  private async prepareCardForSale(tx: Tx, userId: string, userCardId: string) {
    const trade = await tx.gachaTrade.findFirst({
      where: {
        status: 'PENDING',
        OR: [
          { offeredUserCardId: userCardId },
          { requestedUserCardId: userCardId },
          { cards: { some: { userCardId } } },
        ],
      },
      select: { id: true },
    });
    if (trade) throw new ConflictException('Carta em troca pendente.');
    await tx.user.updateMany({
      where: { id: userId, featuredUserCardId: userCardId },
      data: { featuredUserCardId: null, featuredSettledAt: null },
    });
  }

  private conditionLabel(condition: number): string {
    if (condition <= 0.07) return 'MINT';
    if (condition <= 0.15) return 'NM';
    if (condition <= 0.38) return 'EX';
    if (condition <= 0.55) return 'PLAYED';
    return 'POOR';
  }

  private weekStart(): Date {
    const today = dateFromDayKey(dayKey());
    const daysSinceMonday = (today.getUTCDay() + 6) % 7;
    return new Date(today.getTime() - daysSinceMonday * 86_400_000);
  }

  private async assertEconomyEnabled(tx: Tx, userId: string) {
    const [user, rollout] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          crystalBalance: true,
          gachaMarketBlockedAt: true,
          role: true,
        },
      }),
      tx.gachaConfig.findUnique({ where: { key: 'economy_rollout_percent' } }),
    ]);
    if (user.crystalBalance < 0 || user.gachaMarketBlockedAt) {
      throw new ForbiddenException(
        'Economia bloqueada por saldo negativo ou revisão.',
      );
    }
    const percent = Number(rollout?.value ?? 0);
    const bucket =
      createHash('sha256').update(userId).digest().readUInt32BE(0) % 100;
    if (user.role === 'USER' && bucket >= percent) {
      throw new ForbiddenException(
        'Economia ainda não liberada para esta conta.',
      );
    }
  }

  private async nightMarketDay(): Promise<Date | null> {
    const [startConfig, durationConfig] = await Promise.all([
      this.prisma.gachaConfig.findUnique({
        where: { key: 'night_market_start_day' },
      }),
      this.prisma.gachaConfig.findUnique({
        where: { key: 'night_market_duration_days' },
      }),
    ]);
    const start = Number(startConfig?.value ?? 1);
    const duration = Number(durationConfig?.value ?? 7);
    const day = Number(dayKey().slice(-2));
    return day >= start && day < start + duration
      ? dateFromDayKey(
          `${dayKey().slice(0, 8)}${String(start).padStart(2, '0')}`,
        )
      : null;
  }

  private async assertMarketEligible(tx: Tx, userId: string) {
    await this.assertEconomyEnabled(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { isVerified: true, createdAt: true },
    });
    if (!user.isVerified)
      throw new ForbiddenException('Verifique o e-mail para usar o mercado.');
    if (user.createdAt.getTime() > Date.now() - 7 * 86_400_000) {
      throw new ForbiddenException('Conta precisa ter pelo menos sete dias.');
    }
  }

  private async expireOrders(tx: Tx, userId?: string) {
    const expired = await tx.gachaBuyOrder.findMany({
      where: { userId, status: 'ACTIVE', expiresAt: { lte: new Date() } },
      select: { id: true, price: true, userId: true },
    });
    if (expired.length === 0) return;
    for (const order of expired) {
      const changed = await tx.gachaBuyOrder.updateMany({
        where: { id: order.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });
      if (changed.count)
        await tx.user.update({
          where: { id: order.userId },
          data: { crystalReserved: { decrement: order.price } },
        });
    }
  }

  private async spend(
    tx: Tx,
    userId: string,
    amount: number,
    reason: string,
    refId: string,
  ) {
    await this.assertEconomyEnabled(tx, userId);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { crystalBalance: true, crystalReserved: true },
    });
    if (user.crystalBalance - user.crystalReserved < amount) {
      throw new BadRequestException('Crystal disponível insuficiente.');
    }
    await tx.user.update({
      where: { id: userId },
      data: { crystalBalance: { decrement: amount } },
    });
    await tx.crystalEvent.create({
      data: { userId, delta: -amount, type: 'SPEND', refId, reason },
    });
  }

  private async credit(
    tx: Tx,
    userId: string,
    amount: number,
    type: 'DAILY' | 'MINT' | 'SALE',
    refId: string | null | undefined,
    reason: string,
  ) {
    await tx.user.update({
      where: { id: userId },
      data: { crystalBalance: { increment: amount } },
    });
    await tx.crystalEvent.create({
      data: { userId, delta: amount, type, refId, reason },
    });
  }

  private isUniqueError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
