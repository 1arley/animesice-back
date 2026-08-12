import request from 'supertest';
import { getHttpServer, getPrismaService } from './setup/e2e.setup';

/**
 * Busca fuzzy (e2e) — /anime?search=
 *
 * O typo "kagua" só encontra "Kaguya-sama: Love Is War" via word_similarity
 * (pg_trgm); a busca contains antiga não acharia (não é substring).
 *
 * REQUISITO: a migration 20260812120000_add_fuzzy_search precisa estar
 * aplicada no banco de e2e (migrate deploy — o CI usa isso; `db push` não
 * cria pg_trgm e o teste de typo cairia no fallback contains e falharia).
 */
describe('Anime search fuzzy (e2e)', () => {
  const slug = 'e2e-kaguya-sama';

  beforeAll(async () => {
    await getPrismaService().anime.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title: 'Kaguya-sama: Love Is War',
        japaneseTitle: 'かぐや様は告らせたい',
        alternativeTitles: ['Kaguya-sama wa Kokurasetai'],
      },
    });
  });

  afterAll(async () => {
    await getPrismaService()
      .anime.delete({ where: { slug } })
      .catch(() => undefined);
  });

  it('typo "kagua" encontra o anime via fuzzy', async () => {
    const res = await request(getHttpServer())
      .get('/anime')
      .query({ search: 'kagua' })
      .expect(200);

    const slugs = res.body.data.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain(slug);
  });

  it('busca exata "kaguya" continua funcionando (sem regressão do contains)', async () => {
    const res = await request(getHttpServer())
      .get('/anime')
      .query({ search: 'kaguya' })
      .expect(200);

    const slugs = res.body.data.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain(slug);
  });

  it('busca sem relação não retorna o anime', async () => {
    const res = await request(getHttpServer())
      .get('/anime')
      .query({ search: 'zzzzz' })
      .expect(200);

    const slugs = res.body.data.map((a: { slug: string }) => a.slug);
    expect(slugs).not.toContain(slug);
  });
});
