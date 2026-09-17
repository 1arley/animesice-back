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
});
