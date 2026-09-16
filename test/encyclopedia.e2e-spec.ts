import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import {
  createTestUser,
  getApp,
  getHttpServer,
  getPrismaService,
} from '@test/setup/e2e.setup';

describe('Enciclopédia paginada', () => {
  const prefix = `Encyclopedia-${randomUUID()}`;
  let userId: string;
  let token: string;
  let animeIds: string[];
  let cardIds: string[];

  beforeAll(async () => {
    const prisma = getPrismaService();
    const user = await createTestUser(`${prefix}@example.com`);
    userId = user.id;
    token = getApp()
      .get(JwtService)
      .sign(
        { sub: user.id, role: user.role },
        { secret: process.env.JWT_ACCESS_SECRET },
      );
    const animes = await Promise.all(
      ['A', 'B', 'C'].map((suffix) =>
        prisma.anime.create({
          data: { title: `${prefix} ${suffix}`, slug: `${prefix}-${suffix}` },
        }),
      ),
    );
    animeIds = animes.map((anime) => anime.id);
    cardIds = [];
    for (let i = 0; i < 5; i++) {
      const card = await prisma.card.create({
        data: {
          malCharacterId: -Math.floor(Math.random() * 2000000000) - 1,
          name: `${prefix} Card ${i}`,
          rarity: i === 1 ? 'RARA' : 'COMUM',
          animeId: i < 2 ? animeIds[0] : i < 4 ? animeIds[1] : animeIds[2],
        },
      });
      cardIds.push(card.id);
    }
    await prisma.userCard.createMany({
      data: [0, 0, 2, 3].map((index, edition) => ({
        userId,
        cardId: cardIds[index]!,
        condition: 0.5,
        value: 10,
        edition: edition + 1,
      })),
    });
  });

  afterAll(async () => {
    const prisma = getPrismaService();
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (cardIds)
      await prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    if (animeIds)
      await prisma.anime.deleteMany({ where: { id: { in: animeIds } } });
  });

  const get = (
    query: Record<string, string | number | undefined>,
    auth = true,
  ) => {
    const req = request(getHttpServer())
      .get('/gacha/encyclopedia')
      .query({ search: prefix, ...query });
    return auth ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('pagina cartas, filtra posse/raridade e não duplica cópias', async () => {
    const first = await get({ limit: 2 }).expect(200);
    expect(first.body.cards.map((card: { id: string }) => card.id)).toEqual(
      cardIds.slice(0, 2),
    );
    expect(
      first.body.cards.map((card: { owned: boolean }) => card.owned),
    ).toEqual([true, false]);
    expect(first.body.meta).toMatchObject({ total: 5, totalPages: 3 });
    const second = await get({ limit: 2, page: 2 }).expect(200);
    expect(second.body.cards.map((card: { id: string }) => card.id)).toEqual(
      cardIds.slice(2, 4),
    );
    const missing = await get({
      ownership: 'missing',
      animeId: animeIds[0]!,
      rarity: 'RARA',
    }).expect(200);
    expect(missing.body.cards.map((card: { id: string }) => card.id)).toEqual([
      cardIds[1],
    ]);
    const owned = await get({ ownership: 'owned' }).expect(200);
    expect(owned.body.meta.total).toBe(3);
    const guest = await get({}, false).expect(200);
    expect(
      guest.body.cards.every((card: { owned: boolean }) => !card.owned),
    ).toBe(true);
  });

  it('agrega conjuntos completos e iniciados com contagens globais', async () => {
    const all = await get({ view: 'sets', limit: 1 }).expect(200);
    expect(all.body.meta).toMatchObject({ total: 3, totalPages: 3 });
    expect(all.body.sets).toHaveLength(1);
    expect(all.body.sets[0]).toMatchObject({
      animeId: animeIds[0],
      total: 2,
      owned: 1,
      complete: false,
    });
    expect(all.body.sets[0]).not.toHaveProperty('cards');
    const near = await get({ view: 'sets', progress: 'near' }).expect(200);
    expect(
      near.body.sets.map((set: { animeId: string }) => set.animeId),
    ).toEqual([animeIds[0]]);
    const complete = await get({ view: 'sets', progress: 'complete' }).expect(
      200,
    );
    expect(complete.body.sets[0]).toMatchObject({
      animeId: animeIds[1],
      total: 2,
      owned: 2,
      complete: true,
    });
    const searched = await get({
      view: 'sets',
      search: `${prefix} Card 0`,
    }).expect(200);
    expect(searched.body.sets[0]).toMatchObject({ total: 2, owned: 1 });
    const outside = await get({ view: 'sets', page: 50 }).expect(200);
    expect(outside.body.sets).toEqual([]);
    expect(outside.body.meta.total).toBe(3);
  });

  it('rejeita parâmetros inválidos e trata busca como texto', async () => {
    for (const query of [
      { page: 0 },
      { page: 1.5 },
      { limit: 999 },
      { view: 'invalid' },
      { animeId: 'invalid' },
      { ownership: 'invalid' },
      { rarity: 'invalid' },
    ]) {
      await get(query).expect(400);
    }
    const result = await get({ view: 'sets', search: "' OR 1=1 --" }).expect(
      200,
    );
    expect(result.body.meta.total).toBe(0);
  });
});
