import { ConflictException, NotFoundException } from '@nestjs/common';
import { WishlistService } from '@/gacha/wishlist.service';

function makePrisma() {
  return {
    user: { findUnique: jest.fn(), update: jest.fn() },
    card: { findUnique: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    anime: { findUnique: jest.fn() },
    userCard: { findMany: jest.fn() },
    gachaCardWishlist: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    gachaSetWishlist: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('WishlistService', () => {
  it('recusa desejo de carta já atendido por cópia compatível', async () => {
    const prisma = makePrisma();
    prisma.card.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE' });
    prisma.gachaCardWishlist.findUnique.mockResolvedValue(null);
    prisma.userCard.findMany.mockResolvedValue([
      { condition: 0.05, foil: 'NORMAL', edition: 1 },
    ]);
    const service = new WishlistService(prisma as never);

    await expect(service.upsertCard('u1', 'c1', {})).rejects.toThrow(
      ConflictException,
    );
  });

  it('recusa conjunto sem cartas ativas', async () => {
    const prisma = makePrisma();
    prisma.card.count.mockResolvedValue(0);
    const service = new WishlistService(prisma as never);

    await expect(service.upsertSet('u1', 'a1', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('pagina cartas e conjuntos de forma independente', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      userName: 'ana',
      name: 'Ana',
      gachaWishlistPublic: true,
    });
    prisma.gachaCardWishlist.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({
        id: `w${index}`,
        userId: 'u1',
        cardId: `c${index}`,
        priority: 'NORMAL',
        acceptedFoils: [],
        minCondition: null,
        maxEdition: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        card: {
          id: `c${index}`,
          name: `Carta ${index}`,
          image: null,
          imageHidden: false,
          animeId: 'a1',
          anime: { id: 'a1', slug: 'a1', title: 'A1', malId: 1 },
        },
      })),
    );
    prisma.gachaSetWishlist.findMany.mockResolvedValue([
      {
        id: 's1',
        userId: 'u1',
        animeId: 'a1',
        priority: 'NORMAL',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        anime: { id: 'a1', slug: 'a1', title: 'A1', coverImage: null },
      },
    ]);
    prisma.userCard.findMany.mockResolvedValue([]);
    prisma.card.findMany.mockResolvedValue([{ id: 'c0', animeId: 'a1' }]);
    const service = new WishlistService(prisma as never);

    const first = await service.list('u1', 'u1', { limit: 24, page: 1 });
    expect(first.cards).toHaveLength(24);
    expect(first.meta.cards).toBe(30);
    expect(first.meta.page).toBe(1);
    expect(first.meta.totalPages).toBe(2);
    expect(first.meta.cardsTotalPages).toBe(2);
    expect(first.sets).toHaveLength(1);
    expect(first.meta.setsTotalPages).toBe(1);

    // Página 2 das cartas não pode esconder o conjunto, que cabe na página 1.
    const second = await service.list('u1', 'u1', {
      limit: 24,
      cardsPage: 2,
      setsPage: 1,
    });
    expect(second.cards).toHaveLength(6);
    expect(second.sets).toHaveLength(1);
    expect(second.meta.cardsPage).toBe(2);
    expect(second.meta.page).toBe(2);
    expect(second.meta.totalPages).toBe(2);

    const legacy = await service.list('u1', 'u1', { limit: 24, page: 2 });
    expect(legacy.cards).toHaveLength(6);
    expect(legacy.sets).toHaveLength(1);
    expect(legacy.meta.page).toBe(2);
    expect(legacy.meta.totalPages).toBe(2);
  });

  it('limita a página ao total real de cada lista', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      userName: 'ana',
      name: 'Ana',
      gachaWishlistPublic: true,
    });
    prisma.gachaCardWishlist.findMany.mockResolvedValue([
      {
        id: 'w1',
        userId: 'u1',
        cardId: 'c1',
        priority: 'NORMAL',
        acceptedFoils: [],
        minCondition: null,
        maxEdition: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        card: {
          id: 'c1',
          name: 'Carta 1',
          image: null,
          imageHidden: false,
          animeId: null,
          anime: null,
        },
      },
    ]);
    prisma.gachaSetWishlist.findMany.mockResolvedValue([]);
    prisma.userCard.findMany.mockResolvedValue([]);
    prisma.card.findMany.mockResolvedValue([]);
    const service = new WishlistService(prisma as never);

    const result = await service.list('u1', 'u1', { cardsPage: 99 });
    expect(result.meta.cardsPage).toBe(1);
    expect(result.cards).toHaveLength(1);
  });
});
