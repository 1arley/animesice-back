import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';
import { GachaConfigService } from '@/gacha/gacha-config.service';
import {
  cardValue,
  GACHA_TIERS,
  pickWeighted,
  type GachaTier,
  type RoulettePrizeConfig,
} from '@/gacha/gacha.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { EconomyService } from './economy.service';
import {
  CATALOG_ITEM_IDS,
  catalogItem,
  creditItems,
  ESSENCE_KINDS,
  lockInventory,
  type CatalogItemId,
  type EssenceKind,
} from './item-catalog';

type Tx = Prisma.TransactionClient;

const ESSENCE_ROULETTE_WEIGHTS: Record<EssenceKind, number> = {
  ESSENCIA_COMUM: 38,
  ESSENCIA_INCOMUM: 24,
  ESSENCIA_RARA: 16,
  ESSENCIA_EPICA: 11,
  ESSENCIA_LENDARIA: 6,
  ESSENCIA_MITICA: 3.5,
  ESSENCIA_GALACTICA: 1.5,
};

const FOIL_SHARD_WEIGHTS: Record<
  'HOLO_SHARD' | 'GOLD_SHARD' | 'INK_SHARD' | 'PRISM_SHARD',
  number
> = {
  HOLO_SHARD: 40,
  GOLD_SHARD: 25,
  INK_SHARD: 20,
  PRISM_SHARD: 15,
};

const FOIL_GEM_WEIGHTS: Record<
  'HOLO_GEM' | 'GOLD_GEM' | 'INK_GEM' | 'PRISM_GEM',
  number
> = {
  HOLO_GEM: 40,
  GOLD_GEM: 25,
  INK_GEM: 20,
  PRISM_GEM: 15,
};

const CARD_TIER_WEIGHTS: Record<GachaTier, number> = {
  COMUM: 42,
  INCOMUM: 28,
  RARA: 16,
  EPICA: 8.5,
  LENDARIA: 4,
  MITICA: 1.2,
  GALACTICA: 0.3,
};

function isCatalogItemId(
  value: string | null | undefined,
): value is CatalogItemId {
  return (
    typeof value === 'string' &&
    (CATALOG_ITEM_IDS as readonly string[]).includes(value)
  );
}

function pickWeightedPrize(prizes: RoulettePrizeConfig[]): {
  prize: RoulettePrizeConfig;
  index: number;
} {
  const total = prizes.reduce((acc, item) => acc + item.weight, 0);
  if (total <= 0) {
    throw new BadRequestException('Nenhum prêmio ativo disponível na roleta.');
  }
  let cursor = Math.random() * total;
  for (let index = 0; index < prizes.length; index++) {
    const item = prizes[index];
    if (!item) continue;
    cursor -= item.weight;
    if (cursor < 0) return { prize: item, index };
  }
  const fallback = prizes[prizes.length - 1];
  if (!fallback) {
    throw new BadRequestException('Nenhum prêmio ativo disponível na roleta.');
  }
  return { prize: fallback, index: prizes.length - 1 };
}

@Injectable()
export class RouletteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gachaConfig: GachaConfigService,
    private readonly crystalAccounting: CrystalAccountingService,
    private readonly economy: EconomyService,
  ) {}

  private activeWheelPrizes(): RoulettePrizeConfig[] {
    return this.gachaConfig.roulettePrizes.filter(
      (item) => item.enabled && item.weight > 0,
    );
  }

  async getRewardsHub(userId: string) {
    const [inventory, recentSpins, recentDailyClaims] = await Promise.all([
      this.economy.inventory(userId),
      this.prisma.gachaRouletteSpin.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      this.prisma.crystalEvent.findMany({
        where: { userId, type: { in: ['DAILY', 'WATCH'] } },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          delta: true,
          type: true,
          reason: true,
          createdAt: true,
        },
      }),
    ]);

    const enabled = this.gachaConfig.rouletteEnabled;
    const activePrizes = this.activeWheelPrizes();
    const rouletteSpins = inventory.rouletteSpins ?? 0;

    // Nunca expor pesos, probabilidades individuais ou raridades nas fatias da roleta.
    const wheelPrizes = activePrizes.map((prize) => ({
      id: prize.id,
      label: prize.label,
      category: prize.category,
      itemId: prize.itemId ?? null,
      quantity: prize.quantity,
    }));

    const pendingCount =
      (inventory.dailyClaimedToday ? 0 : 1) +
      (inventory.weeklyRewardReady ? 1 : 0) +
      (enabled ? rouletteSpins : 0);

    return {
      enabled,
      spinsAvailable: rouletteSpins,
      pendingCount,
      wheelPrizes,
      recentSpins,
      recentDailyClaims,
      probabilityDisclosure:
        'Os prêmios da roleta possuem pesos configurados no servidor. O sorteio é determinado exclusivamente pelo backend após o acionamento do giro.',
    };
  }

  async spinRoulette(userId: string, operationId: string) {
    const normalizedOp =
      typeof operationId === 'string' ? operationId.trim() : '';
    if (normalizedOp.length < 8 || normalizedOp.length > 100) {
      throw new BadRequestException('operationId inválido para o giro.');
    }

    const activePrizes = this.activeWheelPrizes();
    const existing = await this.prisma.gachaRouletteSpin.findUnique({
      where: {
        userId_operationId: { userId, operationId: normalizedOp },
      },
    });
    if (existing) {
      const inv = await this.prisma.gachaInventory.findUnique({
        where: { userId },
        select: { rouletteSpins: true },
      });
      const existingIndex = activePrizes.findIndex(
        (item) => item.id === existing.prizeId,
      );
      return {
        spinId: existing.id,
        operationId: existing.operationId,
        prizeIndex: existingIndex >= 0 ? existingIndex : 0,
        prize: {
          id: existing.prizeId,
          label: existing.prizeLabel,
          category: existing.category,
          itemId: existing.itemId,
          quantity: existing.quantity,
        },
        reward: existing.reward,
        spinsRemaining: inv?.rouletteSpins ?? 0,
        createdAt: existing.createdAt,
      };
    }

    if (!this.gachaConfig.rouletteEnabled) {
      throw new BadRequestException(
        'A roleta de prêmios está temporariamente desativada.',
      );
    }
    if (activePrizes.length === 0) {
      throw new BadRequestException(
        'Nenhum prêmio ativo disponível na roleta.',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        await lockInventory(tx, userId);

        const replay = await tx.gachaRouletteSpin.findUnique({
          where: {
            userId_operationId: { userId, operationId: normalizedOp },
          },
        });
        if (replay) {
          const inv = await tx.gachaInventory.findUnique({
            where: { userId },
            select: { rouletteSpins: true },
          });
          const replayIndex = activePrizes.findIndex(
            (item) => item.id === replay.prizeId,
          );
          return {
            spinId: replay.id,
            operationId: replay.operationId,
            prizeIndex: replayIndex >= 0 ? replayIndex : 0,
            prize: {
              id: replay.prizeId,
              label: replay.prizeLabel,
              category: replay.category,
              itemId: replay.itemId,
              quantity: replay.quantity,
            },
            reward: replay.reward,
            spinsRemaining: inv?.rouletteSpins ?? 0,
            createdAt: replay.createdAt,
          };
        }

        const inv = await tx.gachaInventory.findUniqueOrThrow({
          where: { userId },
          select: { rouletteSpins: true },
        });
        if (inv.rouletteSpins < 1) {
          throw new BadRequestException(
            'Você não possui giros da roleta disponíveis.',
          );
        }

        const consumed = await tx.gachaInventory.updateMany({
          where: { userId, rouletteSpins: { gte: 1 } },
          data: { rouletteSpins: { decrement: 1 } },
        });
        if (consumed.count !== 1) {
          throw new BadRequestException(
            'Você não possui giros da roleta disponíveis.',
          );
        }

        const { prize, index: prizeIndex } = pickWeightedPrize(activePrizes);
        const granted = await this.grantRoulettePrize(
          tx,
          userId,
          prize,
          normalizedOp,
        );

        const record = await tx.gachaRouletteSpin.create({
          data: {
            userId,
            operationId: normalizedOp,
            prizeId: prize.id,
            prizeLabel: prize.label,
            category: prize.category,
            itemId: granted.itemId,
            quantity: prize.quantity,
            reward: granted.reward,
          },
        });

        return {
          spinId: record.id,
          operationId: record.operationId,
          prizeIndex,
          prize: {
            id: prize.id,
            label: prize.label,
            category: prize.category,
            itemId: granted.itemId,
            quantity: prize.quantity,
          },
          reward: granted.reward,
          spinsRemaining: inv.rouletteSpins - 1,
          createdAt: record.createdAt,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async grantRoulettePrize(
    tx: Tx,
    userId: string,
    prize: RoulettePrizeConfig,
    operationId: string,
  ): Promise<{ itemId: string | null; reward: Prisma.InputJsonValue }> {
    const qty = Math.max(1, prize.quantity);

    switch (prize.category) {
      case 'CRYSTAL': {
        await this.crystalAccounting.credit(
          tx,
          userId,
          qty,
          'MINT',
          operationId,
          `Roleta de Prêmios: ${prize.label}`,
        );
        return {
          itemId: null,
          reward: { category: 'CRYSTAL', amount: qty },
        };
      }

      case 'KEY':
      case 'SPIN_RESET':
      case 'COMMON_BOX':
      case 'RARE_BOX':
      case 'PREMIUM_BOX': {
        const itemId = prize.category as CatalogItemId;
        await creditItems(tx, userId, [{ itemId, quantity: qty }]);
        return {
          itemId,
          reward: {
            category: prize.category,
            itemId,
            itemName: catalogItem(itemId).name,
            quantity: qty,
          },
        };
      }

      case 'KEY_RARE_BOX': {
        await creditItems(tx, userId, [
          { itemId: 'KEY', quantity: qty },
          { itemId: 'RARE_BOX', quantity: qty },
        ]);
        return {
          itemId: null,
          reward: {
            category: 'KEY_RARE_BOX',
            keys: qty,
            rareBoxes: qty,
            quantity: qty,
          },
        };
      }

      case 'KEY_PREMIUM_BOX': {
        await creditItems(tx, userId, [
          { itemId: 'KEY', quantity: qty },
          { itemId: 'PREMIUM_BOX', quantity: qty },
        ]);
        return {
          itemId: null,
          reward: {
            category: 'KEY_PREMIUM_BOX',
            keys: qty,
            premiumBoxes: qty,
            quantity: qty,
          },
        };
      }

      case 'ITEM': {
        const resolvedId: CatalogItemId = isCatalogItemId(prize.itemId)
          ? prize.itemId
          : 'TITANITA_SHARD';
        await creditItems(tx, userId, [{ itemId: resolvedId, quantity: qty }]);
        return {
          itemId: resolvedId,
          reward: {
            category: 'ITEM',
            itemId: resolvedId,
            itemName: catalogItem(resolvedId).name,
            quantity: qty,
          },
        };
      }

      case 'FOIL_SHARD': {
        const shardId: CatalogItemId = isCatalogItemId(prize.itemId)
          ? prize.itemId
          : pickWeighted(FOIL_SHARD_WEIGHTS);
        await creditItems(tx, userId, [{ itemId: shardId, quantity: qty }]);
        return {
          itemId: shardId,
          reward: {
            category: 'FOIL_SHARD',
            itemId: shardId,
            itemName: catalogItem(shardId).name,
            quantity: qty,
          },
        };
      }

      case 'FOIL_GEM': {
        const gemId: CatalogItemId = isCatalogItemId(prize.itemId)
          ? prize.itemId
          : pickWeighted(FOIL_GEM_WEIGHTS);
        await creditItems(tx, userId, [{ itemId: gemId, quantity: qty }]);
        return {
          itemId: gemId,
          reward: {
            category: 'FOIL_GEM',
            itemId: gemId,
            itemName: catalogItem(gemId).name,
            quantity: qty,
          },
        };
      }

      case 'ESSENCE': {
        const essenceId: EssenceKind =
          prize.itemId &&
          (ESSENCE_KINDS as readonly string[]).includes(prize.itemId)
            ? (prize.itemId as EssenceKind)
            : pickWeighted(ESSENCE_ROULETTE_WEIGHTS);
        await creditItems(tx, userId, [{ itemId: essenceId, quantity: qty }]);
        return {
          itemId: essenceId,
          reward: {
            category: 'ESSENCE',
            itemId: essenceId,
            itemName: catalogItem(essenceId).name,
            quantity: qty,
          },
        };
      }

      case 'CARD': {
        const cardReward = await this.mintRouletteCard(tx, userId, operationId);
        return { itemId: null, reward: cardReward };
      }

      case 'SKIN': {
        const skinReward = await this.mintRouletteSkin(tx, userId, operationId);
        return { itemId: null, reward: skinReward };
      }

      case 'CARD_BACK': {
        const backReward = await this.grantRouletteCardBack(
          tx,
          userId,
          operationId,
        );
        return { itemId: null, reward: backReward };
      }
    }
  }

  private async mintRouletteCard(
    tx: Tx,
    userId: string,
    operationId: string,
  ): Promise<Prisma.InputJsonValue> {
    const tierOrder = [pickWeighted(CARD_TIER_WEIGHTS), ...GACHA_TIERS];
    let selected: {
      id: string;
      name: string;
      image: string | null;
      imageHidden: boolean;
      rarity: string;
    } | null = null;

    for (const tier of tierOrder) {
      const count = await tx.card.count({
        where: { status: 'ACTIVE', rarity: tier },
      });
      if (count > 0) {
        const skip = Math.floor(Math.random() * count);
        const found = await tx.card.findMany({
          where: { status: 'ACTIVE', rarity: tier },
          take: 1,
          skip,
          select: {
            id: true,
            name: true,
            image: true,
            imageHidden: true,
            rarity: true,
          },
        });
        if (found[0]) {
          selected = found[0];
          break;
        }
      }
    }

    if (!selected) {
      const fallbackCrystals = 250;
      await this.crystalAccounting.credit(
        tx,
        userId,
        fallbackCrystals,
        'MINT',
        operationId,
        'Roleta de Prêmios (compensação carta)',
      );
      return {
        category: 'CRYSTAL',
        amount: fallbackCrystals,
        fallbackFrom: 'CARD',
      };
    }

    const counter = await tx.card.update({
      where: { id: selected.id },
      data: { editionCounter: { increment: 1 } },
      select: { editionCounter: true },
    });
    const foil = pickWeighted(this.gachaConfig.foilWeights);
    const condition = Number(Math.random().toFixed(4));
    const value = cardValue(
      selected.rarity as GachaTier,
      condition,
      foil,
      counter.editionCounter,
      this.gachaConfig.baseValue,
      this.gachaConfig.foilMult,
    );

    const userCard = await tx.userCard.create({
      data: {
        userId,
        originalUserId: userId,
        cardId: selected.id,
        condition,
        foil,
        edition: counter.editionCounter,
        value,
        rankedValue: value,
      },
    });
    await tx.gachaCardDiscovery.createMany({
      data: { userId, cardId: selected.id },
      skipDuplicates: true,
    });

    return {
      category: 'CARD',
      userCardId: userCard.id,
      cardId: selected.id,
      name: selected.imageHidden ? '???' : selected.name,
      image: selected.imageHidden ? null : selected.image,
      rarity: selected.rarity,
      foil,
      edition: counter.editionCounter,
    };
  }

  private async mintRouletteSkin(
    tx: Tx,
    userId: string,
    operationId: string,
  ): Promise<Prisma.InputJsonValue> {
    const skins = await tx.gachaSkin.findMany({
      where: { active: true, blocked: false },
    });
    const skin = skins.length
      ? skins[Math.floor(Math.random() * skins.length)]
      : null;

    if (!skin) {
      const fallbackCrystals = 300;
      await this.crystalAccounting.credit(
        tx,
        userId,
        fallbackCrystals,
        'MINT',
        operationId,
        'Roleta de Prêmios (compensação skin)',
      );
      return {
        category: 'CRYSTAL',
        amount: fallbackCrystals,
        fallbackFrom: 'SKIN',
      };
    }

    const copy = await tx.userGachaSkin.create({
      data: {
        userId,
        skinId: skin.id,
        name: skin.name,
        imageUrl: skin.imageUrl,
        rarity: skin.rarity,
      },
    });

    return {
      category: 'SKIN',
      userSkinId: copy.id,
      skinId: skin.id,
      name: skin.name,
      imageUrl: skin.imageUrl,
    };
  }

  private async grantRouletteCardBack(
    tx: Tx,
    userId: string,
    operationId: string,
  ): Promise<Prisma.InputJsonValue> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { gachaCosmetics: true },
    });
    const available = await tx.gachaCardBack.findMany({
      where: {
        status: 'PUBLISHED',
        type: 'BACK',
        key: { notIn: user.gachaCosmetics },
      },
    });
    const chosen = available.length
      ? available[Math.floor(Math.random() * available.length)]
      : null;

    if (chosen) {
      await tx.user.update({
        where: { id: userId },
        data: { gachaCosmetics: { push: chosen.key } },
      });
      return {
        category: 'CARD_BACK',
        key: chosen.key,
        name: chosen.name,
      };
    }

    const fallbackCrystals = 250;
    await this.crystalAccounting.credit(
      tx,
      userId,
      fallbackCrystals,
      'MINT',
      operationId,
      'Roleta de Prêmios (capa duplicada/compensação)',
    );
    return {
      category: 'CARD_BACK',
      duplicate: true,
      crystals: fallbackCrystals,
    };
  }

  // ── Admin ─────────────────────────────────────────────────

  async adminGetRoulette(query: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * limit;

    const where: Prisma.GachaRouletteSpinWhereInput = {};
    if (query.category && query.category.trim()) {
      where.category = query.category.trim();
    }
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { prizeLabel: { contains: term, mode: 'insensitive' } },
        { user: { name: { contains: term, mode: 'insensitive' } } },
        { user: { userName: { contains: term, mode: 'insensitive' } } },
        { user: { email: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [totalSpins, spinsLast24h, byCategory, total, data] =
      await Promise.all([
        this.prisma.gachaRouletteSpin.count(),
        this.prisma.gachaRouletteSpin.count({
          where: { createdAt: { gte: since24h } },
        }),
        this.prisma.gachaRouletteSpin.groupBy({
          by: ['category'],
          _count: { category: true },
        }),
        this.prisma.gachaRouletteSpin.count({ where }),
        this.prisma.gachaRouletteSpin.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                userName: true,
                email: true,
                avatar: true,
              },
            },
          },
        }),
      ]);

    const prizes = this.gachaConfig.roulettePrizes;
    const totalWeight = prizes
      .filter((p) => p.enabled && p.weight > 0)
      .reduce((acc, p) => acc + p.weight, 0);

    return {
      enabled: this.gachaConfig.rouletteEnabled,
      spinDropChance: this.gachaConfig.rouletteSpinDropChance,
      prizes: prizes.map((prize) => ({
        ...prize,
        probabilityPct:
          prize.enabled && prize.weight > 0 && totalWeight > 0
            ? Number(((prize.weight / totalWeight) * 100).toFixed(2))
            : 0,
      })),
      stats: {
        totalSpins,
        spinsLast24h,
        byCategory: byCategory.map((row) => ({
          category: row.category,
          count: row._count.category,
        })),
      },
      history: {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    };
  }

  async adminUpdateRouletteConfig(
    adminId: string,
    body: {
      enabled?: boolean;
      spinDropChance?: number;
      prizes?: RoulettePrizeConfig[];
      reason?: string;
    },
  ) {
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'Atualização da roleta de prêmios';

    if (body.enabled !== undefined) {
      await this.gachaConfig.update(
        'roulette_enabled',
        body.enabled,
        adminId,
        reason,
      );
    }
    if (body.spinDropChance !== undefined) {
      await this.gachaConfig.update(
        'roulette_spin_drop_chance',
        body.spinDropChance,
        adminId,
        reason,
      );
    }
    if (body.prizes !== undefined) {
      await this.gachaConfig.update(
        'roulette_prizes',
        body.prizes as unknown as Prisma.InputJsonValue,
        adminId,
        reason,
      );
    }

    return {
      enabled: this.gachaConfig.rouletteEnabled,
      spinDropChance: this.gachaConfig.rouletteSpinDropChance,
      prizes: this.gachaConfig.roulettePrizes,
    };
  }

  async adminGrantRouletteSpins(
    userId: string,
    adminId: string,
    amount: number,
    reason: string,
  ) {
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount === 0 ||
      amount < -1000 ||
      amount > 1000
    ) {
      throw new BadRequestException(
        'Quantidade deve ser um inteiro diferente de zero entre -1000 e 1000.',
      );
    }
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason) {
      throw new BadRequestException('Motivo obrigatório para conceder giros.');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Usuário não encontrado.');

      await lockInventory(tx, userId);
      const current = await tx.gachaInventory.findUniqueOrThrow({
        where: { userId },
        select: { rouletteSpins: true },
      });
      const next = Math.max(0, current.rouletteSpins + amount);

      await tx.gachaInventory.update({
        where: { userId },
        data: { rouletteSpins: next },
      });
      await tx.gachaAdminChange.create({
        data: {
          adminId,
          action: 'GRANT_ROULETTE_SPINS',
          before: { userId, rouletteSpins: current.rouletteSpins },
          after: { userId, rouletteSpins: next, delta: amount },
          reason: cleanReason,
        },
      });

      return {
        userId,
        rouletteSpins: next,
        delta: amount,
      };
    });
  }
}
