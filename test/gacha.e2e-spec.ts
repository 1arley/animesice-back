import request from 'supertest';
import { Role } from '@prisma/client';
import {
  createTestUser,
  getHttpServer,
  getPrismaService,
} from '@test/setup/e2e.setup';

describe('GachaController (e2e)', () => {
  let userId: string;
  let otherUserId: string | undefined;
  let cookie: string;
  let accessToken: string;

  beforeEach(async () => {
    const prisma = getPrismaService();
    const user = await createTestUser(
      `gacha-${Date.now()}@example.com`,
      'Password123!',
      'Gacha User',
      Role.USER,
      true,
    );
    userId = user.id;

    const login = await request(getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'Password123!' })
      .expect(200);
    const setCookies = login.headers['set-cookie'];
    if (!Array.isArray(setCookies)) throw new Error('Auth cookies ausentes.');
    cookie = setCookies.map((value: string) => value.split(';')[0]).join('; ');
    accessToken = setCookies
      .find((value: string) => value.startsWith('access_token='))!
      .split(';')[0]
      .slice('access_token='.length);

    await prisma.card.create({
      data: {
        malCharacterId: Math.floor(Math.random() * 2_000_000_000),
        name: 'Gacha Card',
        rarity: 'COMUM',
      },
    });
  });

  afterEach(async () => {
    const prisma = getPrismaService();
    if (otherUserId) {
      await prisma.user.delete({ where: { id: otherUserId } });
      otherUserId = undefined;
    }
    await prisma.gachaSpin.deleteMany({ where: { userId } });
    await prisma.userCard.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.card.deleteMany({ where: { name: 'Gacha Card' } });
  });

  it('consulta cristais e concede apenas um bônus por dia UTC sob concorrência', async () => {
    const prisma = getPrismaService();
    await request(getHttpServer()).get('/gacha/crystals').expect(401);
    const initial = await request(getHttpServer())
      .get('/gacha/crystals')
      .set('Cookie', cookie)
      .expect(200);
    expect(initial.body.balance).toBe(0);

    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(getHttpServer())
          .post('/gacha/crystals/daily')
          .set('Cookie', cookie),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 403]);
    expect(results.find((result) => result.status === 201)?.body).toEqual({
      claimed: 350,
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    await prisma.gachaDailyClaim.deleteMany({ where: { userId } });
    await request(getHttpServer())
      .post('/gacha/crystals/daily')
      .set('Cookie', cookie)
      .expect(201);
    const ledger = await request(getHttpServer())
      .get('/gacha/crystals?page=1&limit=1')
      .set('Cookie', cookie)
      .expect(200);
    expect(ledger.body.balance).toBe(700);
    expect(ledger.body.events).toHaveLength(1);
    expect(ledger.body.meta).toEqual({
      total: 2,
      page: 1,
      limit: 1,
      totalPages: 2,
    });
    await request(getHttpServer())
      .get('/gacha/crystals?page=1.5')
      .set('Cookie', cookie)
      .expect(400);
  });

  it('expõe coleção pública sem login e preserva a privacidade e as escritas protegidas', async () => {
    const prisma = getPrismaService();
    const card = await prisma.card.findFirstOrThrow({
      where: { name: 'Gacha Card' },
    });
    const owned = await prisma.userCard.create({
      data: {
        userId,
        cardId: card.id,
        condition: 0.05,
        edition: 1,
        value: 100,
        rankedValue: 100,
      },
    });
    const url = `/gacha/collection?userId=${userId}`;
    const visible = await request(getHttpServer()).get(url).expect(200);
    expect(visible.body.data[0].id).toBe(owned.id);
    expect(visible.body.stats).toEqual({
      total: 1,
      totalValue: 100,
      medals: [],
    });
    await request(getHttpServer()).get('/gacha/collection').expect(400);

    await prisma.privacySettings.upsert({
      where: { userId },
      create: { userId, showGacha: false },
      update: { showGacha: false },
    });
    await request(getHttpServer()).get(url).expect(403);
    await request(getHttpServer())
      .get(url)
      .set('Authorization', 'Bearer invalid')
      .expect(403);
    const owner = await request(getHttpServer())
      .get('/gacha/collection')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(owner.body.data[0].id).toBe(owned.id);

    await prisma.user.update({
      where: { id: userId },
      data: { isVerified: false },
    });
    await request(getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(getHttpServer())
      .post('/gacha/spin')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await request(getHttpServer()).post('/gacha/spin').expect(401);
  });

  it('permite no máximo um claim concorrente para o mesmo preview', async () => {
    const spin = await request(getHttpServer())
      .post('/gacha/spin')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const results = await Promise.all(
      [1, 2].map(() =>
        request(getHttpServer())
          .post('/gacha/claim')
          .set('Cookie', cookie)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ spinId: spin.body.id }),
      ),
    );

    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status >= 400)).toHaveLength(1);
    await expect(
      getPrismaService().userCard.count({ where: { userId } }),
    ).resolves.toBe(1);
  });

  it('crafta fragmentos do mesmo foil uma única vez sob concorrência', async () => {
    const prisma = getPrismaService();
    await prisma.gachaInventory.upsert({
      where: { userId },
      create: { userId, holoShards: 20, goldShards: 19 },
      update: { holoShards: 20, goldShards: 19 },
    });
    const results = await Promise.all(
      [1, 2].map(() =>
        request(getHttpServer())
          .post('/gacha/economy/gems/craft')
          .set('Cookie', cookie)
          .send({ foil: 'HOLO' }),
      ),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status >= 400)).toHaveLength(1);
    const inventory = await prisma.gachaInventory.findUniqueOrThrow({
      where: { userId },
    });
    expect(inventory.holoShards).toBe(0);
    expect(inventory.holoGems).toBe(1);
    expect(inventory.goldShards).toBe(19);

    await request(getHttpServer())
      .post('/gacha/economy/gems/craft')
      .set('Cookie', cookie)
      .send({ foil: 'GOLD' })
      .expect(400);
    expect(
      (await prisma.gachaInventory.findUniqueOrThrow({ where: { userId } }))
        .goldGems,
    ).toBe(0);

    await prisma.gachaInventory.update({
      where: { userId },
      data: { holoShards: 20, holoGems: 2_147_483_647 },
    });
    await request(getHttpServer())
      .post('/gacha/economy/gems/craft')
      .set('Cookie', cookie)
      .send({ foil: 'HOLO' })
      .expect(400);
    const afterOverflow = await prisma.gachaInventory.findUniqueOrThrow({
      where: { userId },
    });
    expect(afterOverflow.holoShards).toBe(20);
    expect(afterOverflow.holoGems).toBe(2_147_483_647);
  });

  it('aplica gema apenas em carta NORMAL própria e reverte foil se faltar gema', async () => {
    const prisma = getPrismaService();
    const card = await prisma.card.findFirstOrThrow({
      where: { name: 'Gacha Card' },
    });
    const owned = await prisma.userCard.create({
      data: {
        userId,
        cardId: card.id,
        condition: 0.05,
        edition: 1,
        value: 100,
        rankedValue: 100,
      },
    });
    await prisma.gachaInventory.upsert({
      where: { userId },
      create: { userId, holoGems: 1 },
      update: { holoGems: 1 },
    });
    const foils = [
      ['HOLO', 'holoGems'],
      ['GOLD', 'goldGems'],
      ['INK', 'inkGems'],
      ['PRISM', 'prismGems'],
    ] as const;
    for (const [foil, gemField] of foils) {
      await prisma.userCard.update({
        where: { id: owned.id },
        data: { foil: 'NORMAL' },
      });
      await prisma.gachaInventory.update({
        where: { userId },
        data: { [gemField]: 1 },
      });
      await request(getHttpServer())
        .post('/gacha/economy/gems/apply')
        .set('Cookie', cookie)
        .send({ foil, userCardId: owned.id })
        .expect(201);
      expect(
        (await prisma.userCard.findUniqueOrThrow({ where: { id: owned.id } }))
          .foil,
      ).toBe(foil);
      expect(
        (await prisma.gachaInventory.findUniqueOrThrow({ where: { userId } }))[
          gemField
        ],
      ).toBe(0);
    }

    await request(getHttpServer())
      .post('/gacha/economy/gems/apply')
      .set('Cookie', cookie)
      .send({ foil: 'HOLO', userCardId: owned.id })
      .expect(400);
    expect(
      (await prisma.userCard.findUniqueOrThrow({ where: { id: owned.id } }))
        .foil,
    ).toBe('PRISM');

    await prisma.userCard.update({
      where: { id: owned.id },
      data: { foil: 'NORMAL' },
    });
    await request(getHttpServer())
      .post('/gacha/economy/gems/apply')
      .set('Cookie', cookie)
      .send({ foil: 'GOLD', userCardId: owned.id })
      .expect(400);
    expect(
      (await prisma.userCard.findUniqueOrThrow({ where: { id: owned.id } }))
        .foil,
    ).toBe('NORMAL');
  });

  it('não altera carta nem gemas ao tentar aplicar em carta de outro usuário', async () => {
    const prisma = getPrismaService();
    const other = await createTestUser(
      `gacha-other-${Date.now()}@example.com`,
      'Password123!',
      'Other Gacha User',
      Role.USER,
      true,
    );
    otherUserId = other.id;
    const card = await prisma.card.findFirstOrThrow({
      where: { name: 'Gacha Card' },
    });
    const foreign = await prisma.userCard.create({
      data: {
        userId: other.id,
        cardId: card.id,
        condition: 0.05,
        edition: 1,
        value: 100,
        rankedValue: 100,
      },
    });
    await prisma.gachaInventory.upsert({
      where: { userId },
      create: { userId, holoGems: 1 },
      update: { holoGems: 1 },
    });
    await request(getHttpServer())
      .post('/gacha/economy/gems/apply')
      .set('Cookie', cookie)
      .send({ foil: 'HOLO', userCardId: foreign.id })
      .expect(404);
    expect(
      (await prisma.userCard.findUniqueOrThrow({ where: { id: foreign.id } }))
        .foil,
    ).toBe('NORMAL');
    expect(
      (await prisma.gachaInventory.findUniqueOrThrow({ where: { userId } }))
        .holoGems,
    ).toBe(1);
  });

  it('aplica uma única gema em duas requisições simultâneas', async () => {
    const prisma = getPrismaService();
    const card = await prisma.card.findFirstOrThrow({
      where: { name: 'Gacha Card' },
    });
    const owned = await prisma.userCard.create({
      data: {
        userId,
        cardId: card.id,
        condition: 0.2,
        edition: 1,
        value: 100,
        rankedValue: 100,
      },
    });
    await prisma.gachaInventory.upsert({
      where: { userId },
      create: { userId, goldGems: 1 },
      update: { goldGems: 1 },
    });
    const results = await Promise.all(
      [1, 2].map(() =>
        request(getHttpServer())
          .post('/gacha/economy/gems/apply')
          .set('Cookie', cookie)
          .send({ foil: 'GOLD', userCardId: owned.id }),
      ),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status >= 400)).toHaveLength(1);
    expect(
      (await prisma.userCard.findUniqueOrThrow({ where: { id: owned.id } }))
        .foil,
    ).toBe('GOLD');
    expect(
      (await prisma.gachaInventory.findUniqueOrThrow({ where: { userId } }))
        .goldGems,
    ).toBe(0);
  });

  it('serializa burn e aplicação concorrentes sobre a mesma carta', async () => {
    const prisma = getPrismaService();
    const card = await prisma.card.findFirstOrThrow({
      where: { name: 'Gacha Card' },
    });
    const owned = await prisma.userCard.create({
      data: {
        userId,
        cardId: card.id,
        condition: 0.8,
        edition: 1,
        value: 100,
        rankedValue: 100,
      },
    });
    await prisma.gachaInventory.upsert({
      where: { userId },
      create: { userId, holoGems: 1 },
      update: { holoGems: 1 },
    });
    const [applied, burned] = await Promise.all([
      request(getHttpServer())
        .post('/gacha/economy/gems/apply')
        .set('Cookie', cookie)
        .send({ foil: 'HOLO', userCardId: owned.id }),
      request(getHttpServer())
        .post('/gacha/burn')
        .set('Cookie', cookie)
        .send({ userCardId: owned.id }),
    ]);
    expect([200, 201, 400, 404, 409]).toContain(applied.status);
    expect([200, 201, 400, 404, 409]).toContain(burned.status);
    const [finalCard, inventory, user] = await Promise.all([
      prisma.userCard.findUniqueOrThrow({ where: { id: owned.id } }),
      prisma.gachaInventory.findUniqueOrThrow({ where: { userId } }),
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { crystalBalance: true },
      }),
    ]);
    if (burned.status === 201) {
      expect(finalCard.status).toBe('BURNED');
      expect(user.crystalBalance).toBe(100);
      expect(inventory.holoShards).toBe(applied.status === 201 ? 1 : 0);
      expect(inventory.holoGems).toBe(applied.status === 201 ? 0 : 1);
    } else {
      if (applied.status === 201) {
        expect(finalCard.status).toBe('ACTIVE');
        expect(finalCard.foil).toBe('HOLO');
        expect(inventory.holoGems).toBe(0);
      } else {
        expect(applied.status).toBe(409);
        expect(finalCard.status).toBe('ACTIVE');
        expect(finalCard.foil).toBe('NORMAL');
        expect(inventory.holoGems).toBe(1);
      }
      expect(user.crystalBalance).toBe(0);
    }
  });

  it('reverte o crédito de Crystal e o burn se o saldo de fragmentos estourar', async () => {
    const prisma = getPrismaService();
    const card = await prisma.card.findFirstOrThrow({
      where: { name: 'Gacha Card' },
    });
    await prisma.card.update({
      where: { id: card.id },
      data: { rarity: 'COMUM' },
    });
    const owned = await prisma.userCard.create({
      data: {
        userId,
        cardId: card.id,
        condition: 0.8,
        foil: 'HOLO',
        edition: 1,
        value: 100,
        rankedValue: 100,
      },
    });
    await prisma.gachaInventory.upsert({
      where: { userId },
      create: { userId, holoShards: 2_147_483_647 },
      update: { holoShards: 2_147_483_647 },
    });
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { crystalBalance: true },
    });
    await request(getHttpServer())
      .post('/gacha/burn')
      .set('Cookie', cookie)
      .send({ userCardId: owned.id })
      .expect(409);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { crystalBalance: true },
        })
      ).crystalBalance,
    ).toBe(before.crystalBalance);
    expect(
      (await prisma.userCard.findUniqueOrThrow({ where: { id: owned.id } }))
        .status,
    ).toBe('ACTIVE');
  });
});
