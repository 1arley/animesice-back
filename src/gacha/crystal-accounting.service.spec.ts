import { CrystalEventType, Prisma } from '@prisma/client';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';

describe('CrystalAccountingService', () => {
  it('records valid zero-value credits', async () => {
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      crystalEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
    } as unknown as Prisma.TransactionClient;

    await new CrystalAccountingService().credit(
      tx,
      'user-1',
      0,
      CrystalEventType.SALE,
      'listing-1',
      'Venda no mercado',
    );

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', crystalBalance: { lte: 2_147_483_647 } },
      data: { crystalBalance: { increment: 0 } },
    });
    expect(tx.crystalEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        delta: 0,
        type: CrystalEventType.SALE,
        refId: 'listing-1',
        reason: 'Venda no mercado',
      },
    });
  });
});
