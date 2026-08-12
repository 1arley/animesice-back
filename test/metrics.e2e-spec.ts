import request from 'supertest';
import { getHttpServer } from './setup/e2e.setup';

/**
 * GET /metrics — endpoint de observabilidade protegido por METRICS_TOKEN
 * (header X-Metrics-Token). Determinístico: o teste controla process.env
 * por request (o controller lê no momento da chamada).
 */
describe('Metrics endpoint (e2e)', () => {
  const originalToken = process.env.METRICS_TOKEN;

  afterAll(() => {
    if (originalToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = originalToken;
  });

  it('404 sem METRICS_TOKEN configurado (fail closed)', async () => {
    delete process.env.METRICS_TOKEN;
    await request(getHttpServer()).get('/metrics').expect(404);
  });

  it('401 com token errado', async () => {
    process.env.METRICS_TOKEN = 'secret-token';
    await request(getHttpServer())
      .get('/metrics')
      .set('x-metrics-token', 'wrong-token')
      .expect(401);
  });

  it('200 com token certo devolve o snapshot', async () => {
    process.env.METRICS_TOKEN = 'secret-token';
    const res = await request(getHttpServer())
      .get('/metrics')
      .set('x-metrics-token', 'secret-token')
      .expect(200);
    expect(res.body.cache).toBeDefined();
    expect(res.body.extractions).toBeDefined();
    expect(res.body.bySource).toBeDefined();
  });

  it('401 sem header mesmo com token configurado', async () => {
    process.env.METRICS_TOKEN = 'secret-token';
    await request(getHttpServer()).get('/metrics').expect(401);
  });
});
