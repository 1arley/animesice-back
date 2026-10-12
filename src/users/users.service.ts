import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma, ReportReason } from '@prisma/client';
import { PROFILE_PUBLIC_OR_EMPTY } from '@/common/prisma-filters';
import {
  SHOWCASE_SECTIONS,
  ShowcaseSection,
  UpdateCropsDto,
} from './dto/profile-showcase.dto';

/** Recorte de imagem persistido no User (avatarCrop / profileCoverCrop). */
export type ImageCrop = { x: number; y: number; scale: number };

const MAX_PINS = 3;

/** Carta de gacha no showcase — sem o bloco `user` do PULL_SELECT do gacha. */
const SHOWCASE_CARD_SELECT = {
  id: true,
  condition: true,
  foil: true,
  edition: true,
  value: true,
  skin: { select: { imageUrl: true } },
  card: {
    select: {
      id: true,
      name: true,
      image: true,
      imageHidden: true,
      rarity: true,
      animeId: true,
      animeTitle: true,
      anime: { select: { slug: true, title: true } },
    },
  },
} satisfies Prisma.UserCardSelect;

/**
 * Uma carta de showcase nunca revela nome nem arte de card oculta — mesmo o
 * dono vê o "???" no perfil público, senão basta abrir o perfil de quem
 * comprou a carta pra quebrar o mistério do sorteio.
 */
const presentShowcaseCard = <T extends { card: { imageHidden: boolean } }>(
  pull: T,
) =>
  pull.card.imageHidden
    ? { ...pull, card: { ...pull.card, name: '???', image: null } }
    : pull;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve um identificador de usuário — aceita UUID ou apelido (userName).
   * Todos os endpoints públicos de perfil usam isto, permitindo URLs
   * amigáveis como /users/iarley além do /users/<uuid> legado.
   */
  private async resolveUser(identifier: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: identifier }, { userName: identifier }] },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    return user.id;
  }

  /** Carrega preferências de privacidade do usuário (defaults p/ ausente). */
  private async getPrivacy(userId: string) {
    const p = await this.prisma.privacySettings.findUnique({
      where: { userId },
    });
    return {
      profilePublic: p?.profilePublic ?? true,
      showActivity: p?.showActivity ?? true,
      showFavorites: p?.showFavorites ?? true,
      showRatings: p?.showRatings ?? true,
      showGacha: p?.showGacha ?? true,
    };
  }

  /** Normaliza a ordem das seções: dedup e descarta chaves desconhecidas. */
  private normalizeSections(
    raw: string[] | null | undefined,
  ): ShowcaseSection[] {
    const known = new Set<string>(SHOWCASE_SECTIONS);
    const seen = new Set<ShowcaseSection>();
    for (const key of raw ?? []) {
      if (known.has(key)) seen.add(key as ShowcaseSection);
    }
    return [...seen];
  }

  async getPublicProfile(identifier: string) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        userName: true,
        avatar: true,
        equippedGachaSkin: { select: { imageUrl: true } },
        profileCover: true,
        avatarCrop: true,
        profileCoverCrop: true,
        profileBackground: {
          select: { key: true, name: true, imageUrl: true },
        },
        bio: true,
        myAnimeList: true,
        createdAt: true,
        _count: {
          select: {
            comments: privacy.showActivity,
            ratings: privacy.showRatings,
            favorites: privacy.showFavorites,
            watchHistories: privacy.showActivity,
            // Relações de follow — contadores públicos do perfil, alinhados
            // com as listas de /social/followers e /social/following/:id
            // (só contam perfis públicos; privacidade ausente = público).
            followers: { where: { follower: PROFILE_PUBLIC_OR_EMPTY } },
            following: { where: { followee: PROFILE_PUBLIC_OR_EMPTY } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user;
  }

  /**
   * Showcase do perfil: a vitrine Steam/Twitter — carta em destaque, até 5
   * cartas favoritas, coleção favorita e medalhas de coleção concluída.
   *
   * As seções voltam na ordem escolhida pelo usuário, já normalizadas: o front
   * itera a lista e não reordena. Seção sem conteúdo é omitida do payload,
   * mas continua na lista `sections` para o front não saltar buracos.
   *
   * `progress` da coleção favorita é calculado só com leitura. Não chama
   * GachaService.collectionProgress: aquele método grava as linhas de
   * progresso e credita crystals de marco, e um GET público não pode
   * disparar efeito financeiro.
   */
  async getShowcase(identifier: string) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic || !privacy.showGacha) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        showcaseSections: true,
        favoriteGachaCardIds: true,
        pinnedCollectionIds: true,
        featuredUserCard: { select: SHOWCASE_CARD_SELECT },
        favoriteCollection: {
          select: {
            id: true,
            name: true,
            slug: true,
            version: true,
            members: { select: { cardId: true } },
          },
        },
        gachaCollectionProgress: {
          where: { reward100At: { not: null } },
          select: {
            collectionId: true,
            version: true,
            collection: { select: { name: true } },
          },
        },
      },
    });

    const [favorites, owned] = await Promise.all([
      user.favoriteGachaCardIds.length
        ? this.prisma.userCard.findMany({
            where: {
              id: { in: user.favoriteGachaCardIds },
              userId,
              status: 'ACTIVE',
            },
            select: SHOWCASE_CARD_SELECT,
          })
        : [],
      this.prisma.userCard.findMany({
        where: { userId, status: 'ACTIVE' },
        distinct: ['cardId'],
        select: { cardId: true },
      }),
    ]);

    const favoritesById = new Map(favorites.map((card) => [card.id, card]));
    const ownedIds = new Set(owned.map(({ cardId }) => cardId));

    const collection = user.favoriteCollection;
    const total = collection?.members.length ?? 0;
    const discovered =
      collection?.members.reduce(
        (count, member) => count + Number(ownedIds.has(member.cardId)),
        0,
      ) ?? 0;
    const favoriteCollection = collection
      ? {
          id: collection.id,
          name: collection.name,
          slug: collection.slug,
          version: collection.version,
          total,
          discovered,
          percent: total === 0 ? 0 : Math.floor((discovered * 100) / total),
        }
      : null;

    const medals = user.gachaCollectionProgress
      .filter((row) => user.pinnedCollectionIds.includes(row.collectionId))
      .sort(
        (a, b) =>
          user.pinnedCollectionIds.indexOf(a.collectionId) -
          user.pinnedCollectionIds.indexOf(b.collectionId),
      )
      .slice(0, MAX_PINS)
      .map((row) => ({
        id: row.collectionId,
        name: row.collection.name,
        version: row.version,
      }));

    const payload: Record<ShowcaseSection, unknown> = {
      FEATURED: user.featuredUserCard
        ? presentShowcaseCard(user.featuredUserCard)
        : null,
      FAVORITES: user.favoriteGachaCardIds.flatMap((id) => {
        const card = favoritesById.get(id);
        return card ? [presentShowcaseCard(card)] : [];
      }),
      COLLECTION: favoriteCollection,
      MEDALS: medals,
    };

    return {
      sections: this.normalizeSections(user.showcaseSections),
      data: payload,
    };
  }

  /**
   * Mini-cardápio para hover (Steam): o suficiente para a janela flutuante sem
   * puxar a vitrine inteira. Sem status online de propósito — exigiria
   * lastSeenAt atualizado a cada request autenticado.
   */
  async getHoverCard(identifier: string) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        userName: true,
        avatar: true,
        bio: true,
        profileCover: true,
        createdAt: true,
        featuredUserCard: {
          select: {
            id: true,
            card: {
              select: {
                name: true,
                image: true,
                imageHidden: true,
                rarity: true,
              },
            },
          },
        },
        gachaCollectionProgress: {
          where: { reward100At: { not: null } },
          select: { collectionId: true },
        },
        _count: {
          select: {
            comments: privacy.showActivity,
            ratings: privacy.showRatings,
            favorites: privacy.showFavorites,
            followers: { where: { follower: PROFILE_PUBLIC_OR_EMPTY } },
          },
        },
      },
    });

    const featured = user.featuredUserCard;
    return {
      id: user.id,
      name: user.name,
      userName: user.userName,
      avatar: user.avatar,
      profileCover: user.profileCover,
      bio: user.bio,
      createdAt: user.createdAt,
      featured: featured
        ? {
            id: featured.id,
            name: featured.card.imageHidden ? '???' : featured.card.name,
            image: featured.card.imageHidden ? null : featured.card.image,
            rarity: featured.card.rarity,
          }
        : null,
      medals: user.gachaCollectionProgress.length,
      counts: {
        comments: user._count.comments,
        ratings: user._count.ratings,
        favorites: user._count.favorites,
        followers: user._count.followers,
      },
    };
  }

  /** Recortes do avatar/capa. `null` volta ao enquadramento padrão. */
  async updateCrops(userId: string, dto: UpdateCropsDto) {
    const data: Record<string, unknown> = {};
    if (dto.avatarCrop !== undefined) {
      data.avatarCrop = dto.avatarCrop ?? Prisma.JsonNull;
    }
    if (dto.profileCoverCrop !== undefined) {
      data.profileCoverCrop = dto.profileCoverCrop ?? Prisma.JsonNull;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nada para atualizar.');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { avatarCrop: true, profileCoverCrop: true },
    });
    return {
      avatarCrop: (user.avatarCrop as ImageCrop | null) ?? null,
      profileCoverCrop: (user.profileCoverCrop as ImageCrop | null) ?? null,
    };
  }

  /** Reordena/oculta as seções do showcase. Ordem enviada é preservada. */
  async updateShowcaseSections(userId: string, sections: string[]) {
    const normalized = this.normalizeSections(sections);
    await this.prisma.user.update({
      where: { id: userId },
      data: { showcaseSections: normalized },
    });
    return { sections: normalized };
  }

  /** Presets ativos da galeria de fundos, na ordem do painel. */
  listProfileBackgrounds() {
    return this.prisma.profileBackground.findMany({
      where: { enabled: true },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      select: { key: true, name: true, imageUrl: true },
    });
  }

  /** Troca o fundo do perfil. `key` nulo volta ao fundo sem imagem. */
  async setProfileBackground(userId: string, key: string | null) {
    let profileBackgroundId: string | null = null;
    if (key !== null) {
      const background = await this.prisma.profileBackground.findFirst({
        where: { key, enabled: true },
        select: { id: true, key: true, name: true, imageUrl: true },
      });
      if (!background) {
        throw new BadRequestException('Fundo de perfil indisponível.');
      }
      profileBackgroundId = background.id;
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { profileBackgroundId },
      select: {
        profileBackground: {
          select: { key: true, name: true, imageUrl: true },
        },
      },
    });
    return { profileBackground: user.profileBackground };
  }

  /**
   * Diretório de usuários da comunidade — apenas perfis públicos
   * (privacidade ausente = público). Suporta busca e ordenações:
   *  - new: recém-chegados (createdAt desc)
   *  - active: mais ativos (comentários + avaliações + histórico)
   *  - recommended (padrão): seguidores + atividade
   */
  async searchUsers(
    currentUserId: string | null,
    search?: string,
    sort?: string,
    page: number = 1,
    limit: number = 24,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const publicIds = await this.getPublicUserIds();

    const where: Prisma.UserWhereInput = { id: { in: publicIds } };
    if (search && search.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { userName: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const effectiveSort =
      sort ?? (search && search.trim() ? 'new' : 'recommended');

    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      effectiveSort === 'new'
        ? [{ createdAt: 'desc' }]
        : effectiveSort === 'active'
          ? [
              { comments: { _count: 'desc' } },
              { ratings: { _count: 'desc' } },
              { watchHistories: { _count: 'desc' } },
              { createdAt: 'desc' },
            ]
          : [
              { followers: { _count: 'desc' } },
              { comments: { _count: 'desc' } },
              { createdAt: 'desc' },
            ];

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: safeLimit,
        select: {
          id: true,
          name: true,
          userName: true,
          avatar: true,
          bio: true,
          createdAt: true,
          _count: {
            select: {
              comments: true,
              ratings: true,
              favorites: true,
              watchHistories: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // isFollowing para o usuário logado — marca os que eu já sigo.
    let followingIds = new Set<string>();
    if (currentUserId && users.length > 0) {
      const follows = await this.prisma.follow.findMany({
        where: {
          followerId: currentUserId,
          followeeId: { in: users.map((u) => u.id) },
        },
        select: { followeeId: true },
      });
      followingIds = new Set(follows.map((f) => f.followeeId));
    }

    return {
      data: users.map((u) => ({ ...u, isFollowing: followingIds.has(u.id) })),
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /** IDs de usuários com perfil público (privacidade ausente = público). */
  private async getPublicUserIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM "User" u
      LEFT JOIN "PrivacySettings" p ON p."userId" = u.id
      WHERE COALESCE(p."profilePublic", true) = true
    `;
    return rows.map((r) => r.id);
  }

  async getUserComments(
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic || !privacy.showActivity) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [comments, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where: { userId, status: 'VISIBLE' },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          content: true,
          edited: true,
          createdAt: true,
          anime: { select: { slug: true, title: true } },
        },
      }),
      this.prisma.comment.count({ where: { userId, status: 'VISIBLE' } }),
    ]);

    return {
      data: comments,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getUserRatings(
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic || !privacy.showRatings) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [ratings, total] = await this.prisma.$transaction([
      this.prisma.rating.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          score: true,
          createdAt: true,
          updatedAt: true,
          anime: {
            select: { id: true, slug: true, title: true, coverImage: true },
          },
        },
      }),
      this.prisma.rating.count({ where: { userId } }),
    ]);

    return {
      data: ratings,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getUserFavorites(
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic || !privacy.showFavorites) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const [favorites, total] = await this.prisma.$transaction([
      this.prisma.favorite.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          anime: {
            select: {
              id: true,
              slug: true,
              title: true,
              coverImage: true,
              year: true,
              format: true,
            },
          },
        },
      }),
      this.prisma.favorite.count({ where: { userId } }),
    ]);

    return {
      data: favorites,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getUserAnimeList(
    identifier: string,
    page: number = 1,
    limit: number = 24,
    status?: string,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic || !privacy.showFavorites) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const where: Record<string, unknown> = { userId, private: false };
    if (status) where.status = status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAnimeList.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: { updatedAt: 'desc' },
        include: {
          anime: {
            select: {
              id: true,
              slug: true,
              title: true,
              coverImage: true,
              year: true,
              format: true,
              genres: true,
              episodeCount: true,
            },
          },
        },
      }),
      this.prisma.userAnimeList.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Atividade pública recente — feed cronológico mesclando assistidos,
   * avaliações, favoritos e comentários (gatado por showActivity).
   *
   * Paginação por janela deslocada por fonte (skip/take): cada página é
   * internamente cronológica e não repete eventos entre páginas — o mesmo
   * padrão já usado por /me/activity para o feed do próprio usuário.
   */
  async getUserActivity(
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.showActivity) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;
    const sourceTake = skip + safeLimit;

    const [
      watches,
      ratings,
      favorites,
      comments,
      watchCount,
      ratingCount,
      favCount,
      commentCount,
    ] = await this.prisma.$transaction([
      this.prisma.watchHistory.findMany({
        where: { userId },
        skip: 0,
        take: sourceTake,
        orderBy: { watchedAt: 'desc' },
        select: {
          watchedAt: true,
          episode: {
            select: {
              number: true,
              anime: {
                select: { slug: true, title: true, coverImage: true },
              },
            },
          },
        },
      }),
      this.prisma.rating.findMany({
        where: { userId, ...(privacy.showRatings ? {} : { id: 'never' }) },
        skip: 0,
        take: sourceTake,
        orderBy: { createdAt: 'desc' },
        select: {
          score: true,
          createdAt: true,
          anime: {
            select: { slug: true, title: true, coverImage: true },
          },
        },
      }),
      this.prisma.favorite.findMany({
        where: { userId, ...(privacy.showFavorites ? {} : { id: 'never' }) },
        skip: 0,
        take: sourceTake,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          anime: {
            select: { slug: true, title: true, coverImage: true },
          },
        },
      }),
      this.prisma.comment.findMany({
        where: { userId, status: 'VISIBLE' },
        skip: 0,
        take: sourceTake,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          content: true,
          edited: true,
          createdAt: true,
          anime: { select: { slug: true, title: true } },
          _count: { select: { likes: true } },
        },
      }),
      this.prisma.watchHistory.count({ where: { userId } }),
      this.prisma.rating.count({
        where: { userId, ...(privacy.showRatings ? {} : { id: 'never' }) },
      }),
      this.prisma.favorite.count({
        where: { userId, ...(privacy.showFavorites ? {} : { id: 'never' }) },
      }),
      this.prisma.comment.count({ where: { userId, status: 'VISIBLE' } }),
    ]);

    const events = [
      ...watches.map((w) => ({
        type: 'watch' as const,
        episodeNumber: w.episode.number,
        anime: w.episode.anime,
        createdAt: w.watchedAt.toISOString(),
      })),
      ...ratings.map((r) => ({
        type: 'rating' as const,
        score: r.score,
        anime: r.anime,
        createdAt: r.createdAt.toISOString(),
      })),
      ...favorites.map((f) => ({
        type: 'favorite' as const,
        anime: f.anime,
        createdAt: f.createdAt.toISOString(),
      })),
      ...comments.map((c) => ({
        type: 'comment' as const,
        id: c.id,
        content: c.content,
        edited: c.edited,
        likeCount: c._count.likes,
        anime: c.anime,
        createdAt: c.createdAt.toISOString(),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const total = watchCount + ratingCount + favCount + commentCount;

    return {
      data: events.slice(skip, skip + safeLimit),
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getUserStats(identifier: string) {
    const userId = await this.resolveUser(identifier);
    const privacy = await this.getPrivacy(userId);
    if (!privacy.profilePublic) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        _count: {
          select: {
            comments: privacy.showActivity,
            ratings: privacy.showRatings,
            favorites: privacy.showFavorites,
            watchHistories: privacy.showActivity,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user._count;
  }

  async reportUser(
    reporterId: string,
    identifier: string,
    reason: ReportReason,
    notes?: string,
  ) {
    const targetUserId = await this.resolveUser(identifier);

    if (reporterId === targetUserId) {
      throw new BadRequestException('Você não pode denunciar a si mesmo.');
    }

    return this.prisma.report.create({
      data: {
        reporterId,
        targetType: 'USER',
        targetId: targetUserId,
        reason,
        notes,
      },
      include: {
        reporter: { select: { id: true, name: true, userName: true } },
      },
    });
  }
}
