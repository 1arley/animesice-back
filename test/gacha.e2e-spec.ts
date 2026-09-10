import request from 'supertest';
import { Role } from '@prisma/client';
import {
  createTestUser,
  getHttpServer,
  getPrismaService,
} from '@test/setup/e2e.setup';

describe('GachaController (e2e)', () => {
  let userId: string;
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
    await prisma.gachaSpin.deleteMany({ where: { userId } });
    await prisma.userCard.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.card.deleteMany({ where: { name: 'Gacha Card' } });
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
});
