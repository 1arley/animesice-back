import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ECONOMY_DEFAULTS } from './economy/economy.config';
import {
  assertClaimEvent,
  GachaConfigService,
} from '@/gacha/gacha-config.service';

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
    value: { ...ECONOMY_DEFAULTS.tier_weights, COMUM: 55, GALACTICA: 0.1 },
    label: 'Pesos',
    group: 'rates',
  },
  {
    key: 'box_category_weights',
    value: ECONOMY_DEFAULTS.box_category_weights,
    label: 'Pesos das caixas',
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
    expect(service.tierWeights).toEqual(ECONOMY_DEFAULTS.tier_weights);
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

  it('rejects invalid box category weights before updating config', async () => {
    await expect(
      service.update(
        'box_category_weights',
        { COMMON: { CRYSTAL: -1 } },
        'admin',
        'invalid weights',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.gachaConfig.update).not.toHaveBeenCalled();
  });
});

describe('GachaConfigService — claim_event', () => {
  let service: GachaConfigService;

  async function build(rows: Array<{ key: string; value: unknown }>) {
    const module = await Test.createTestingModule({
      providers: [
        GachaConfigService,
        {
          provide: PrismaService,
          useValue: {
            gachaConfig: { findMany: jest.fn().mockResolvedValue(rows) },
          },
        },
      ],
    }).compile();
    const instance = module.get<GachaConfigService>(GachaConfigService);
    await instance.refresh();
    return instance;
  }

  it('sem chave no banco, evento fica inativo e override cai no global', async () => {
    service = await build([]);
    expect(service.claimEventState().active).toBe(false);
    expect(service.effectiveSpinsPerHour()).toBeNaN(); // sem spins_per_hour: NaN do global
  });

  it('active=true sem janela fica ativo; fora da janela, inativo', async () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const base = { active: true, name: 'E', tiers: ['COMUM'] };

    service = await build([{ key: 'claim_event', value: base }]);
    expect(service.claimEventState(now)).toMatchObject({
      active: true,
      name: 'E',
    });

    service = await build([
      {
        key: 'claim_event',
        value: { ...base, startsAt: '2026-11-21T00:00:00Z' },
      },
    ]);
    expect(service.claimEventState(now).active).toBe(false);

    service = await build([
      {
        key: 'claim_event',
        value: { ...base, endsAt: '2026-11-19T00:00:00Z' },
      },
    ]);
    expect(service.claimEventState(now).active).toBe(false);
  });

  it('valor malformado nunca derruba: mantém inativo e filtra tiers', async () => {
    service = await build([
      {
        key: 'claim_event',
        value: {
          active: 'yes',
          name: 42,
          startsAt: 'não-é-data',
          tiers: ['COMUM', 'INVENTADA', 7],
          spinsPerHour: 'muito',
        },
      },
    ]);
    const state = service.claimEventState();
    expect(state.active).toBe(false);
    expect(state.tiers).toEqual(['COMUM']);
    expect(service.effectiveSpinsPerHour()).toBeNaN();
  });

  it('effectiveSpinsPerHour usa override do evento quando ativo e válido', async () => {
    service = await build([
      { key: 'spins_per_hour', value: 5 },
      {
        key: 'claim_event',
        value: { active: true, tiers: [], spinsPerHour: 8 },
      },
    ]);
    expect(service.effectiveSpinsPerHour()).toBe(8);
  });

  describe('assertClaimEvent', () => {
    it('aceita payload válido completo', () => {
      expect(() =>
        assertClaimEvent({
          active: true,
          name: 'Semana',
          startsAt: '2026-11-20T03:00:00.000Z',
          endsAt: null,
          tiers: ['COMUM', 'EPICA'],
          spinsPerHour: null,
        }),
      ).not.toThrow();
    });

    it('rejeita shape inválido com BadRequest', () => {
      expect(() => assertClaimEvent([])).toThrow(BadRequestException);
      expect(() => assertClaimEvent({ active: 'sim' })).toThrow(
        /active deve ser boolean/,
      );
      expect(() => assertClaimEvent({ startsAt: 'ontem' })).toThrow(/startsAt/);
      expect(() => assertClaimEvent({ tiers: ['INVENTADA'] })).toThrow(
        /tiers deve ser lista/,
      );
      expect(() => assertClaimEvent({ spinsPerHour: 0 })).toThrow(
        /spinsPerHour/,
      );
    });
  });
});
