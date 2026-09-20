import request from 'supertest';
import { createTestUser, getHttpServer } from '@test/setup/e2e.setup';

describe('User avatar upload (e2e)', () => {
  it('accepts a JPEG avatar up to 1 MB through multipart', async () => {
    const agent = request.agent(getHttpServer());
    await createTestUser(
      'avatar@example.com',
      'Password123!',
      'Avatar User',
      undefined,
      true,
    );
    await agent
      .post('/auth/login')
      .send({ email: 'avatar@example.com', password: 'Password123!' })
      .expect(200);

    await agent
      .post('/user/me/avatar')
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        filename: 'avatar.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.avatar).toContain('/avatars/');
      });
  });

  it('rejects avatars larger than 1 MB', async () => {
    const agent = request.agent(getHttpServer());
    await createTestUser(
      'large-avatar@example.com',
      'Password123!',
      'Large Avatar User',
      undefined,
      true,
    );
    await agent
      .post('/auth/login')
      .send({ email: 'large-avatar@example.com', password: 'Password123!' })
      .expect(200);

    await agent
      .post('/user/me/avatar')
      .attach('file', Buffer.alloc(1024 * 1024 + 1), {
        filename: 'avatar.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
  });
});
