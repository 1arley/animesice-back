import { ConflictException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { IS_PUBLIC_KEY } from '@/auth/decorators/public.decorator';
import { EconomyService } from './economy.service';
import { EconomyController } from './economy.controller';
import { ECONOMY_DEFAULTS, economyConfig } from './economy.config';
import { MarketQueryDto } from './economy.dto';

function model() {
  return Object.fromEntries(
    [
      'findFirst',
      'findUnique',
      'findUniqueOrThrow',
      'findMany',
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
      'count',
      'deleteMany',
      'aggregate',
    ].map((name) => [name, jest.fn()]),
  ) as Record<string, jest.Mock>;
}

describe('EconomyService safeguards', () => {
  let db: any;
  let service: EconomyService;
  beforeEach(() => {
    db = Object.fromEntries(
      [
        'user',
        'card',
        'userCard',
        'gachaSkin',
        'userGachaSkin',
        'gachaCardBack',
        'gachaConfig',
        'gachaEconomyVersion',
        'gachaInventory',
        'gachaRetention',
        'gachaOpening',
        'gachaOpeningDay',
        'gachaBuyOrder',
        'gachaListing',
        'gachaSkinListing',
        'crystalEvent',
        'gachaMarketSale',
        'gachaAdminChange',
        'gachaTrade',
        'gachaOfficialOffer',
        'gachaSpin',
      ].map((name) => [name, model()]),
    );
    db.$transaction = jest.fn((work) => work(db));
    db.$queryRaw = jest.fn().mockResolvedValue([]);
    db.gachaEconomyVersion.findFirst.mockResolvedValue({
      id: 'version-2',
      version: 2,
      snapshot: ECONOMY_DEFAULTS,
    });
    db.gachaConfig.findUnique.mockResolvedValue({ value: 100 });
    db.user.findUniqueOrThrow.mockResolvedValue({
      crystalBalance: 10000,
      crystalReserved: 0,
      isVerified: true,
      createdAt: new Date('2020-01-01'),
      role: 'USER',
    });
    db.gachaBuyOrder.findMany.mockResolvedValue([]);
    db.gachaListing.findMany.mockResolvedValue([]);
    db.gachaSkinListing.findMany.mockResolvedValue([]);
    db.gachaInventory.updateMany.mockResolvedValue({ count: 1 });
    db.gachaRetention.upsert.mockResolvedValue({ loyaltyRarePlusReady: false });
    db.gachaRetention.update.mockResolvedValue({ loyaltyDays: 1 });
    db.gachaOpeningDay.createMany.mockResolvedValue({ count: 1 });
    db.gachaOpening.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    );
    service = new EconomyService(db);
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses published weights and prices and records exactly that version', async () => {
    db.gachaEconomyVersion.findFirst.mockResolvedValue({
      id: 'version-9',
      version: 9,
      snapshot: {
        ...ECONOMY_DEFAULTS,
        key_price: 2000,
        box_prices: { COMMON: 3000, RARE: 5500, PREMIUM: 8500 },
      },
    });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const result = await service.openBox('u1', 'COMMON');
    expect(result.opening).toMatchObject({
      economyVersionId: 'version-9',
      category: 'CRYSTAL',
      amount: 1000,
    });
    expect(db.gachaOpening.create).toHaveBeenCalledTimes(1);
    expect(db.crystalEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ delta: 1000 }),
      }),
    );
    expect(db.gachaInventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { commonBoxes: { decrement: 1 }, keys: { decrement: 1 } },
      }),
    );
  });

  it('credits a spin reset reward to the inventory', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.51);

    const result = await service.openBox('u1', 'COMMON');

    expect(result.reward).toEqual({ category: 'SPIN_RESET', amount: 1 });
    expect(db.gachaInventory.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', spinResets: 1 },
      update: { spinResets: { increment: 1 } },
    });
  });

  it('rejects invalid economic snapshots rather than producing invalid rewards', () => {
    expect(() =>
      economyConfig({ ...ECONOMY_DEFAULTS, box_prices: {} }),
    ).toThrow(ConflictException);
    expect(() =>
      economyConfig({ ...ECONOMY_DEFAULTS, market_tax_pct: 2 }),
    ).toThrow(ConflictException);
    expect(() =>
      economyConfig({
        ...ECONOMY_DEFAULTS,
        foil_weights: { NORMAL: 0, HOLO: 0, GOLD: 0 },
      }),
    ).toThrow(ConflictException);
  });

  it('does not require verified email for boxes, but rejects blocked accounts', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, EconomyController)).toEqual([
      JwtAuthGuard,
    ]);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, EconomyController.prototype.odds),
    ).toBe(true);
    db.user.findUniqueOrThrow.mockResolvedValue({
      crystalBalance: 10000,
      crystalReserved: 0,
      isVerified: false,
      role: 'USER',
    });
    await expect(service.buyKey('u1')).resolves.toMatchObject({ price: 1500 });
    db.user.findUniqueOrThrow.mockResolvedValue({
      crystalBalance: 10000,
      gachaMarketBlockedAt: new Date(),
    });
    await expect(service.buyKey('u1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects market use for unverified and young accounts', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({
      crystalBalance: 1000,
      isVerified: false,
      role: 'USER',
    });
    await expect(
      service.createBuyOrder('u1', {
        itemType: 'CARD',
        itemId: 'card',
        price: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    db.user.findUniqueOrThrow.mockResolvedValue({
      crystalBalance: 1000,
      isVerified: true,
      createdAt: new Date(),
      role: 'USER',
    });
    await expect(
      service.createBuyOrder('u1', {
        itemType: 'CARD',
        itemId: 'card',
        price: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('starts rollout with admins only', async () => {
    db.gachaConfig.findUnique.mockResolvedValue({ value: 0 });
    await expect(service.buyKey('u1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    db.user.findUniqueOrThrow.mockResolvedValue({
      role: 'ADMIN',
      crystalBalance: 10000,
      crystalReserved: 0,
    });
    await expect(service.buyKey('admin')).resolves.toMatchObject({
      price: 1500,
    });
  });

  it('expires escrow items and releases only orders transitioned by this worker', async () => {
    db.gachaBuyOrder.findMany.mockResolvedValue([
      { id: 'o1', userId: 'u1', price: 200 },
      { id: 'o2', userId: 'u2', price: 900 },
    ]);
    db.gachaBuyOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    db.gachaListing.findMany.mockResolvedValue([
      { id: 'l1', userId: 'u1', userCardId: 'c1' },
    ]);
    db.gachaListing.updateMany.mockResolvedValue({ count: 1 });
    db.gachaSkinListing.findMany.mockResolvedValue([
      { id: 'l2', userId: 'u2', userSkinId: 's1' },
    ]);
    db.gachaSkinListing.updateMany.mockResolvedValue({ count: 1 });
    await service.expireMarket();
    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { crystalReserved: { decrement: 200 } },
    });
    expect(db.userCard.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', userId: 'u1', status: 'ESCROW' },
      data: { status: 'ACTIVE' },
    });
    expect(db.userGachaSkin.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'u2', status: 'ESCROW' },
      data: { status: 'ACTIVE' },
    });
  });

  it('does not release reserve twice when cancellation loses a race', async () => {
    db.gachaBuyOrder.findFirst.mockResolvedValue({ id: 'o1', price: 200 });
    db.gachaBuyOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancelBuyOrder('u1', 'o1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('uses variant history only after five qualifying sales', async () => {
    const sale = (price: number, foil: string) => ({
      price,
      userCard: { foil, condition: 0.05 },
    });
    db.gachaMarketSale.findMany.mockResolvedValue([
      sale(100, 'NORMAL'),
      sale(200, 'NORMAL'),
      sale(1000, 'GOLD'),
      sale(1100, 'GOLD'),
      sale(1200, 'GOLD'),
      sale(1300, 'GOLD'),
    ]);
    expect(
      await service.marketHistory('CARD', 'c1', {
        foil: 'GOLD',
        condition: 'MINT',
      }),
    ).toMatchObject({ scope: 'ITEM', volume: 6, median: 1050 });
    db.gachaMarketSale.findMany.mockResolvedValue([
      sale(100, 'NORMAL'),
      ...[1000, 1100, 1200, 1300, 1400].map((price) => sale(price, 'GOLD')),
    ]);
    expect(
      await service.marketHistory('CARD', 'c1', {
        foil: 'GOLD',
        condition: 'MINT',
      }),
    ).toMatchObject({ scope: 'VARIANT', volume: 5, median: 1200 });
    expect(db.gachaMarketSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ suspicious: false, official: false }),
      }),
    );
  });

  it('public market selects no owner or original owner identity', async () => {
    await service.listings(new MarketQueryDto());
    const selection = db.gachaListing.findMany.mock.calls.at(-1)[0].select;
    expect(selection.userId).toBeUndefined();
    expect(selection.user).toBeUndefined();
    expect(selection.userCard.select.userId).toBeUndefined();
    expect(selection.userCard.select.originalUser).toBeUndefined();
  });

  it('event items leave odds when seven-day window ends', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T15:00:00Z'));
    db.gachaEconomyVersion.findFirst.mockResolvedValue({
      id: 'event-version',
      version: 3,
      snapshot: {
        ...ECONOMY_DEFAULTS,
        economic_event: {
          startDay: 1,
          cardIds: ['event-card'],
          skinIds: ['event-skin'],
          cardBackKeys: ['event-back'],
        },
      },
    });
    db.card.findMany.mockResolvedValue([]);
    db.gachaSkin.findMany.mockResolvedValue([]);
    db.gachaCardBack.findMany.mockResolvedValue([]);
    await service.odds();
    expect(db.card.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ['event-card'] } }),
      }),
    );
    jest.useRealTimers();
  });

  it('blocks item after cancelling orders and listings and compensates each live copy', async () => {
    db.gachaBuyOrder.findMany.mockResolvedValue([
      { id: 'o1', userId: 'buyer', price: 100 },
    ]);
    db.gachaBuyOrder.updateMany.mockResolvedValue({ count: 1 });
    db.card.update.mockResolvedValue({ rarity: 'RARA' });
    db.userCard.findMany.mockResolvedValue([{ id: 'c1', userId: 'owner' }]);
    db.userCard.updateMany.mockResolvedValue({ count: 1 });
    expect(
      await service.blockItem('admin', 'CARD', 'card', 'legal review'),
    ).toMatchObject({ compensated: 1 });
    expect(db.crystalEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'owner',
        delta: 1250,
        type: 'MINT',
        refId: 'c1',
        reason: 'Compensação por bloqueio: legal review',
      },
    });
    expect(db.gachaListing.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.userCard.updateMany.mock.invocationCallOrder[0],
    );
    expect(db.gachaAdminChange.create).toHaveBeenCalled();
  });

  it('audits suspicious transactions and blocks only recurring accounts when requested', async () => {
    const sale = {
      id: 'sale',
      sellerId: 'seller',
      buyerId: 'buyer',
      suspicious: false,
    };
    db.gachaMarketSale.findUniqueOrThrow.mockResolvedValue(sale);
    db.gachaMarketSale.update.mockResolvedValue({ ...sale, suspicious: true });
    db.gachaMarketSale.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    expect(
      await service.reviewSale('admin', 'sale', {
        reason: 'Recurring wash trades',
        suspicious: true,
        blockRecurring: true,
      }),
    ).toMatchObject({ blocked: ['seller'] });
    expect(db.gachaAdminChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminId: 'admin',
          action: 'ECONOMY_SALE_REVIEW',
        }),
      }),
    );
  });

  it('expired official offers cannot be purchased', async () => {
    db.gachaOfficialOffer.findFirst.mockResolvedValue({
      day: new Date('2020-01-01'),
      slot: 0,
    });
    await expect(service.buyOfficialOffer('u1', 'old')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.crystalEvent.create).not.toHaveBeenCalled();
  });
});
