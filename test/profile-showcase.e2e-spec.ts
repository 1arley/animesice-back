import request from 'supertest';
import {
  createTestUser,
  getHttpServer,
  getPrismaService,
} from '@test/setup/e2e.setup';

/**
 * Cobre o round-trip completo da personalização de perfil contra Postgres de
 * verdade: recorte, ordem das seções e fundo. Os unit tests de users.service
 * usam mocks e não provam que a migration, o JsonNull e a FK do fundo
 * funcionam juntos.
 */
describe('Profile customization (e2e)', () => {
  /** getPrismaService() só vale dentro dos testes: o app sobe no beforeAll. */
  const prisma = () => getPrismaService();

  /**
   * createTestUser não grava userName, e o perfil público é resolvido por
   * apelido. Fixa o apelido logo depois de criar a conta.
   */
  async function createUser(email: string, userName: string) {
    await createTestUser(email, 'Password123!', userName, undefined, true);
    await prisma().user.update({
      where: { email },
      data: { userName },
    });
  }

  async function login(email: string) {
    const agent = request.agent(getHttpServer());
    await agent
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);
    return agent;
  }

  it('persists and clears the avatar/cover crop', async () => {
    await createUser('crop@example.com', 'crop');
    const agent = await login('crop@example.com');

    const saved = await agent
      .patch('/users/me/crops')
      .send({ avatarCrop: { x: 25, y: 75, scale: 2 } })
      .expect(200);
    expect(saved.body.avatarCrop).toEqual({ x: 25, y: 75, scale: 2 });
    expect(saved.body.profileCoverCrop).toBeNull();

    // O recorte volta no perfil público para o front aplicar no CSS.
    const profile = await request(getHttpServer())
      .get('/users/crop')
      .expect(200);
    expect(profile.body.avatarCrop).toEqual({ x: 25, y: 75, scale: 2 });
    expect(profile.body.profileCoverCrop).toBeNull();

    await agent
      .patch('/users/me/crops')
      .send({ avatarCrop: null })
      .expect(200)
      .expect(({ body }) => {
        expect(body.avatarCrop).toBeNull();
      });
  });

  it('rejects out-of-range crop values', async () => {
    await createUser('crop-range@example.com', 'crop-range');
    const agent = await login('crop-range@example.com');

    await agent
      .patch('/users/me/crops')
      .send({ avatarCrop: { x: 500, y: 0, scale: 1 } })
      .expect(400);
    await agent
      .patch('/users/me/crops')
      .send({ avatarCrop: { x: 0, y: 0, scale: 99 } })
      .expect(400);
  });

  it('keeps the showcase section order the user chose', async () => {
    await createUser('sections@example.com', 'sections');
    const agent = await login('sections@example.com');

    const updated = await agent
      .patch('/users/me/showcase-sections')
      .send({ sections: ['MEDALS', 'FAVORITES', 'FEATURED'] })
      .expect(200);
    expect(updated.body.sections).toEqual(['MEDALS', 'FAVORITES', 'FEATURED']);

    const showcase = await request(getHttpServer())
      .get('/users/sections/showcase')
      .expect(200);
    expect(showcase.body.sections).toEqual(['MEDALS', 'FAVORITES', 'FEATURED']);
    expect(Object.keys(showcase.body.data)).toEqual([
      'FEATURED',
      'FAVORITES',
      'COLLECTION',
      'MEDALS',
    ]);
  });

  it('rejects unknown showcase sections', async () => {
    await createUser('bad-sections@example.com', 'bad-sections');
    const agent = await login('bad-sections@example.com');
    await agent
      .patch('/users/me/showcase-sections')
      .send({ sections: ['NAO_EXISTE'] })
      .expect(400);
  });

  it('assigns an enabled preset background and refuses a disabled one', async () => {
    const background = await prisma().profileBackground.create({
      data: {
        key: 'e2e-aurora',
        name: 'Aurora E2E',
        imageUrl: 'https://cdn.exemplo.com/aurora.jpg',
        enabled: true,
      },
    });
    const disabled = await prisma().profileBackground.create({
      data: {
        key: 'e2e-off',
        name: 'Desligado E2E',
        imageUrl: 'https://cdn.exemplo.com/off.jpg',
        enabled: false,
      },
    });

    await createUser('background@example.com', 'background');
    const agent = await login('background@example.com');

    await agent
      .patch('/users/me/profile-background')
      .send({ key: 'e2e-aurora' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.profileBackground.key).toBe('e2e-aurora');
      });

    // O preset desabilitado some da galória e não pode ser escolhido.
    const gallery = await request(getHttpServer())
      .get('/users/profile-backgrounds')
      .expect(200);
    expect(gallery.body.map((item: { key: string }) => item.key)).toEqual([
      'e2e-aurora',
    ]);
    await agent
      .patch('/users/me/profile-background')
      .send({ key: 'e2e-off' })
      .expect(400);

    const profile = await request(getHttpServer())
      .get('/users/background')
      .expect(200);
    expect(profile.body.profileBackground).toEqual(
      expect.objectContaining({ key: 'e2e-aurora' }),
    );

    await agent
      .patch('/users/me/profile-background')
      .send({ key: null })
      .expect(200)
      .expect(({ body }) => {
        expect(body.profileBackground).toBeNull();
      });

    await prisma().profileBackground.delete({
      where: { id: background.id },
    });
    await prisma().profileBackground.delete({ where: { id: disabled.id } });
  });

  it('404s the showcase of a private profile', async () => {
    await createUser('private-showcase@example.com', 'private-showcase');
    const agent = await login('private-showcase@example.com');
    await agent
      .patch('/settings/privacy')
      .send({ profilePublic: false })
      .expect(200);

    await request(getHttpServer())
      .get('/users/private-showcase/showcase')
      .expect(404);
  });

  it('serves the hover card without online status', async () => {
    await createUser('hover@example.com', 'hover');

    const hover = await request(getHttpServer())
      .get('/users/hover/hover')
      .expect(200);
    expect(hover.body.userName).toBe('hover');
    expect(hover.body.featured).toBeNull();
    expect(hover.body.medals).toBe(0);
    expect(hover.body.counts).toEqual(
      expect.objectContaining({
        comments: expect.any(Number),
        followers: expect.any(Number),
      }),
    );
    expect(hover.body).not.toHaveProperty('online');
    expect(hover.body).not.toHaveProperty('lastSeenAt');
  });
});
