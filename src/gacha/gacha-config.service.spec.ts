import { GachaConfigService } from './gacha-config.service';

type Row = {
  key: string;
  value: unknown;
  label: string;
  group: string;
};

function model() {
  return {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
}

const rows: Row[] = [
  { key: 'daily_bonus', value: 777, label: 'Bônus diário', group: 'economia' },
  {
    key: 'tier_weights',
    value: { COMUM: 55, GALACTICA: 0.1 },
    label: 'Pesos',
    group: 'rates',
  },
  {
    key: 'spins_per_hour',
    value: 5,
    label: 'Spins por hora',
    group: 'economia',
  },
];

describe('GachaConfigService', () => {
  let db: {
    gachaConfig: ReturnType<typeof model>;
    gachaEconomyVersion: { aggregate: jest.Mock; create: jest.Mock };
  };
  let service: GachaConfigService;

  beforeEach(() => {
    db = {
      gachaConfig: model(),
      gachaEconomyVersion: {
        aggregate: jest.fn(),
        create: jest.fn(),
      },
    };
    db.gachaConfig.findMany.mockResolvedValue(rows);
    db.gachaConfig.update.mockResolvedValue(rows[0]);
    db.gachaEconomyVersion.aggregate.mockResolvedValue({
      _max: { version: null },
    });
    Object.assign(db, {
      $transaction: (work: (tx: typeof db) => Promise<unknown>) => work(db),
    });
    service = new GachaConfigService(db as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('carrega as chaves do banco no onModuleInit e expõe via getters', async () => {
    await service.onModuleInit();
    expect(db.gachaConfig.findMany).toHaveBeenCalledTimes(1);
    expect(service.dailyBonus).toBe(777);
    expect(service.tierWeights).toEqual({ COMUM: 55, GALACTICA: 0.1 });
    expect(service.spinsPerHour).toBe(5);
  });

  it('getters devolvem NaN para chave ausente e objeto para JSON valido', async () => {
    await service.onModuleInit();
    expect(service.rollsPerDay).toBeNaN();
    expect(service.list).toBeDefined();
    expect(await service.list()).toEqual(rows);
  });

  it('update grava valor, incrementa versao com snapshot completo e recarrega cache', async () => {
    await service.onModuleInit();
    db.gachaConfig.findMany.mockResolvedValue(rows);
    const aggregator = db.gachaEconomyVersion.aggregate;
    aggregator.mockResolvedValueOnce({ _max: { version: 4 } });
    const created = { id: 'v5', version: 5 };
    db.gachaEconomyVersion.create.mockResolvedValue(created);

    const result = await service.update('daily_bonus', 800, 'admin', 'bump');

    expect(result).toEqual(rows[0]);
    expect(db.gachaConfig.update).toHaveBeenCalledWith({
      where: { key: 'daily_bonus' },
      data: { value: 800 },
    });
    expect(db.gachaEconomyVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 5,
        authorId: 'admin',
        reason: 'bump',
        snapshot: Object.fromEntries(rows.map((r) => [r.key, r.value])),
      }),
    });
  });

  it('update recarrega o cache apos gravar', async () => {
    await service.onModuleInit();
    db.gachaConfig.findMany.mockResolvedValue([{ ...rows[0], value: 999 }]);
    db.gachaEconomyVersion.create.mockResolvedValue({ id: 'v1', version: 1 });
    await service.update('daily_bonus', 999, 'admin', 'set');
    expect(service.dailyBonus).toBe(999);
  });
});
