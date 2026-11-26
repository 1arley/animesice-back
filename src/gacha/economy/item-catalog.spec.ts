import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { creditItems } from '@/gacha/economy/item-catalog';

describe('creditItems', () => {
  it('counts pending trade escrows before allowing an inventory credit', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ quantity: 3n }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: queryRaw,
      gachaInventory: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany,
      },
    } as unknown as Prisma.TransactionClient;

    await creditItems(tx, 'u1', [{ itemId: 'KEY', quantity: 2 }]);

    const reservationQuery = (
      queryRaw.mock.calls[1]?.[0] as TemplateStringsArray
    ).join('');
    expect(reservationQuery).toContain('FROM "GachaTrade"');
    expect(reservationQuery).toContain('trade."itemsOffered"');
    expect(reservationQuery).toContain('trade."itemsRequested"');
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', keys: { lte: 2_147_483_642 } },
      data: { keys: { increment: 2 } },
    });
  });

  it('rejects a credit when inventory and pending reservations exceed the cap', async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ quantity: 2_147_483_646n }]),
      gachaInventory: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      creditItems(tx, 'u1', [{ itemId: 'KEY', quantity: 2 }]),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
