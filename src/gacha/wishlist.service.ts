import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WishlistPriority } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  UpsertCardWishlistDto,
  UpsertSetWishlistDto,
  WishlistPriorityDto,
} from '@/gacha/dto/gacha.dto';

const CONDITION_LEVEL: Record<string, number> = {
  POOR: 1,
  PLAYED: 2,
  EX: 3,
  NM: 4,
  MINT: 5,
};
const VALID_FOILS = ['NORMAL', 'HOLO', 'GOLD'];

type WishlistOptions = {
  page?: number;
  limit?: number;
  status?: 'pending' | 'complete';
  priority?: WishlistPriorityDto;
  type?: 'cards' | 'sets';
};

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  private isMatchingCondition(value: number, minimum?: string | null) {
    if (!minimum) return true;
    const level =
      value <= 0.07
        ? 5
        : value <= 0.15
          ? 4
          : value <= 0.38
            ? 3
            : value <= 0.55
              ? 2
              : 1;
    return level >= (CONDITION_LEVEL[minimum] ?? 0);
  }

  private matchesCopy(
    copy: { condition: number; foil: string; edition: number },
    wish: {
      acceptedFoils: string[];
      minCondition: string | null;
      maxEdition: number | null;
    },
  ) {
    return (
      (wish.acceptedFoils.length === 0 ||
        wish.acceptedFoils.includes(copy.foil)) &&
      this.isMatchingCondition(copy.condition, wish.minCondition) &&
      (wish.maxEdition === null || copy.edition <= wish.maxEdition)
    );
  }

  private priority(value?: WishlistPriorityDto) {
    return (value ?? WishlistPriorityDto.NORMAL) as WishlistPriority;
  }

  private validateFoils(foils?: string[]) {
    if (foils?.some((foil) => !VALID_FOILS.includes(foil))) {
      throw new BadRequestException('Foil inválido.');
    }
  }

  async list(
    userId: string,
    viewerId: string | null,
    options: WishlistOptions = {},
  ) {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        userName: true,
        name: true,
        gachaWishlistPublic: true,
      },
    });
    if (!owner) throw new NotFoundException('Usuário não encontrado.');
    if (owner.id !== viewerId && !owner.gachaWishlistPublic) {
      return {
        private: true,
        isPublic: false,
        cards: [],
        sets: [],
        meta: { cards: 0, sets: 0 },
      };
    }

    const [cards, sets] = await Promise.all([
      options.type === 'sets'
        ? []
        : this.prisma.gachaCardWishlist.findMany({
            where: {
              userId,
              ...(options.priority
                ? { priority: this.priority(options.priority) }
                : {}),
            },
            orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
            include: {
              card: {
                include: {
                  anime: { select: { id: true, slug: true, title: true } },
                },
              },
            },
          }),
      options.type === 'cards'
        ? []
        : this.prisma.gachaSetWishlist.findMany({
            where: {
              userId,
              ...(options.priority
                ? { priority: this.priority(options.priority) }
                : {}),
            },
            orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
            include: {
              anime: {
                select: { id: true, slug: true, title: true, coverImage: true },
              },
            },
          }),
    ]);

    const cardIds = cards.map((entry) => entry.cardId);
    const animeIds = sets.map((entry) => entry.animeId);
    const owned = await this.prisma.userCard.findMany({
      where: { userId, status: 'ACTIVE', cardId: { in: cardIds } },
      select: { cardId: true, condition: true, foil: true, edition: true },
    });
    const ownedByCard = new Map<string, typeof owned>();
    for (const copy of owned) {
      const values = ownedByCard.get(copy.cardId) ?? [];
      values.push(copy);
      ownedByCard.set(copy.cardId, values);
    }
    const setCards = animeIds.length
      ? await this.prisma.card.findMany({
          where: { animeId: { in: animeIds }, status: 'ACTIVE' },
          select: { id: true, animeId: true },
        })
      : [];
    const ownedIds = new Set(
      (
        await this.prisma.userCard.findMany({
          where: {
            userId,
            status: 'ACTIVE',
            card: { animeId: { in: animeIds } },
          },
          select: { cardId: true },
          distinct: ['cardId'],
        })
      ).map((row) => row.cardId),
    );
    const status = (complete: boolean) =>
      options.status === undefined ||
      (options.status === 'complete') === complete;
    const cardData = cards
      .map((entry) => ({
        ...entry,
        complete: (ownedByCard.get(entry.cardId) ?? []).some((copy) =>
          this.matchesCopy(copy, entry),
        ),
      }))
      .filter((entry) => status(entry.complete));
    const setData = sets
      .map((entry) => {
        const total = setCards.filter(
          (card) => card.animeId === entry.animeId,
        ).length;
        const ownedCount = setCards.filter(
          (card) => card.animeId === entry.animeId && ownedIds.has(card.id),
        ).length;
        return {
          ...entry,
          total,
          owned: ownedCount,
          complete: total > 0 && total === ownedCount,
        };
      })
      .filter((entry) => status(entry.complete));
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 24));
    return {
      private: false,
      isPublic: owner.gachaWishlistPublic,
      cards: cardData.slice((page - 1) * limit, page * limit),
      sets: setData.slice((page - 1) * limit, page * limit),
      meta: {
        cards: cardData.length,
        sets: setData.length,
        page,
        limit,
        totalPages: Math.max(
          1,
          Math.ceil(Math.max(cardData.length, setData.length) / limit),
        ),
      },
    };
  }

  async upsertCard(userId: string, cardId: string, dto: UpsertCardWishlistDto) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true, status: true },
    });
    if (!card || card.status !== 'ACTIVE')
      throw new NotFoundException('Carta não disponível.');
    this.validateFoils(dto.acceptedFoils);
    const existing = await this.prisma.gachaCardWishlist.findUnique({
      where: { userId_cardId: { userId, cardId } },
    });
    const wish = {
      acceptedFoils: dto.acceptedFoils ?? existing?.acceptedFoils ?? [],
      minCondition: dto.minCondition ?? existing?.minCondition ?? null,
      maxEdition: dto.maxEdition ?? existing?.maxEdition ?? null,
    };
    const copies = await this.prisma.userCard.findMany({
      where: { userId, cardId, status: 'ACTIVE' },
      select: { condition: true, foil: true, edition: true },
    });
    if (copies.some((copy) => this.matchesCopy(copy, wish))) {
      throw new ConflictException('Carta já atende este desejo.');
    }
    return this.prisma.gachaCardWishlist.upsert({
      where: { userId_cardId: { userId, cardId } },
      create: {
        userId,
        cardId,
        priority: this.priority(dto.priority),
        ...wish,
      },
      update: {
        ...(dto.priority ? { priority: this.priority(dto.priority) } : {}),
        ...wish,
      },
      include: { card: true },
    });
  }

  async deleteCard(userId: string, cardId: string) {
    await this.prisma.gachaCardWishlist.deleteMany({
      where: { userId, cardId },
    });
    return { deleted: true };
  }

  async upsertSet(userId: string, animeId: string, dto: UpsertSetWishlistDto) {
    const total = await this.prisma.card.count({
      where: { animeId, status: 'ACTIVE' },
    });
    if (!total) throw new NotFoundException('Conjunto sem cartas ativas.');
    const anime = await this.prisma.anime.findUnique({
      where: { id: animeId },
      select: { id: true },
    });
    if (!anime) throw new NotFoundException('Anime não encontrado.');
    return this.prisma.gachaSetWishlist.upsert({
      where: { userId_animeId: { userId, animeId } },
      create: { userId, animeId, priority: this.priority(dto.priority) },
      update: dto.priority ? { priority: this.priority(dto.priority) } : {},
      include: { anime: true },
    });
  }

  async deleteSet(userId: string, animeId: string) {
    await this.prisma.gachaSetWishlist.deleteMany({
      where: { userId, animeId },
    });
    return { deleted: true };
  }

  async setPrivacy(userId: string, isPublic: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { gachaWishlistPublic: isPublic },
      select: { gachaWishlistPublic: true },
    });
  }

  async cardStates(
    userId: string,
    cards: Array<{ id: string; animeId: string | null }>,
  ) {
    if (!cards.length)
      return new Map<
        string,
        { direct: boolean; set: boolean; priority: WishlistPriority | null }
      >();
    const [direct, sets] = await Promise.all([
      this.prisma.gachaCardWishlist.findMany({
        where: { userId, cardId: { in: cards.map((card) => card.id) } },
      }),
      this.prisma.gachaSetWishlist.findMany({
        where: {
          userId,
          animeId: {
            in: cards.flatMap((card) => (card.animeId ? [card.animeId] : [])),
          },
        },
      }),
    ]);
    const directByCard = new Map(direct.map((entry) => [entry.cardId, entry]));
    const setByAnime = new Map(sets.map((entry) => [entry.animeId, entry]));
    return new Map(
      cards.map((card) => {
        const d = directByCard.get(card.id);
        const s = card.animeId ? setByAnime.get(card.animeId) : undefined;
        const priority = d?.priority ?? s?.priority ?? null;
        return [card.id, { direct: Boolean(d), set: Boolean(s), priority }];
      }),
    );
  }

  async interestedCount(
    cardId: string,
    animeId: string | null,
    copy: { condition: number; foil: string; edition: number },
  ) {
    const [direct, sets] = await Promise.all([
      this.prisma.gachaCardWishlist.findMany({
        where: { cardId, user: { gachaWishlistPublic: true } },
      }),
      animeId
        ? this.prisma.gachaSetWishlist.findMany({
            where: { animeId, user: { gachaWishlistPublic: true } },
          })
        : [],
    ]);
    const userIds = [
      ...new Set([
        ...direct.map((row) => row.userId),
        ...sets.map((row) => row.userId),
      ]),
    ];
    if (!userIds.length) return 0;
    const owned = await this.prisma.userCard.findMany({
      where: { userId: { in: userIds }, cardId, status: 'ACTIVE' },
      select: { userId: true, condition: true, foil: true, edition: true },
    });
    const ownedByUser = new Map<string, typeof owned>();
    for (const row of owned)
      ownedByUser.set(row.userId, [
        ...(ownedByUser.get(row.userId) ?? []),
        row,
      ]);
    const directByUser = new Map(direct.map((row) => [row.userId, row]));
    const setUsers = new Set(sets.map((row) => row.userId));
    return userIds.filter((userId) => {
      const copies = ownedByUser.get(userId) ?? [];
      const directWish = directByUser.get(userId);
      if (directWish && this.matchesCopy(copy, directWish))
        return (
          copies.some((ownedCopy) =>
            this.matchesCopy(ownedCopy, directWish),
          ) === false
        );
      if (setUsers.has(userId)) return copies.length === 0;
      return false;
    }).length;
  }

  async interestedUsers(
    cardId: string,
    animeId: string | null,
    copy: { condition: number; foil: string; edition: number },
  ) {
    const [direct, sets] = await Promise.all([
      this.prisma.gachaCardWishlist.findMany({
        where: { cardId, user: { gachaWishlistPublic: true } },
      }),
      animeId
        ? this.prisma.gachaSetWishlist.findMany({
            where: { animeId, user: { gachaWishlistPublic: true } },
          })
        : [],
    ]);
    const userIds = [
      ...new Set([
        ...direct.map((row) => row.userId),
        ...sets.map((row) => row.userId),
      ]),
    ];
    const owned = await this.prisma.userCard.findMany({
      where: { userId: { in: userIds }, cardId, status: 'ACTIVE' },
      select: { userId: true, condition: true, foil: true, edition: true },
    });
    const ownedByUser = new Map<string, typeof owned>();
    for (const row of owned)
      ownedByUser.set(row.userId, [
        ...(ownedByUser.get(row.userId) ?? []),
        row,
      ]);
    const directByUser = new Map(direct.map((row) => [row.userId, row]));
    const setUsers = new Set(sets.map((row) => row.userId));
    const pendingIds = userIds.filter((userId) => {
      const copies = ownedByUser.get(userId) ?? [];
      const directWish = directByUser.get(userId);
      if (directWish && this.matchesCopy(copy, directWish))
        return !copies.some((ownedCopy) =>
          this.matchesCopy(ownedCopy, directWish),
        );
      if (setUsers.has(userId)) return copies.length === 0;
      return false;
    });
    return this.prisma.user.findMany({
      where: { id: { in: pendingIds } },
      select: { id: true, name: true, userName: true, avatar: true },
    });
  }
}
