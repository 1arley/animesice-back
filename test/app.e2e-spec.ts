import request from 'supertest';
import { type App } from 'supertest/types';
import { getApp } from './setup/e2e.setup';

describe('AppController (e2e)', () => {
  it('/ (GET)', () => {
    const app = getApp();
    return request(app.getHttpServer() as App)
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
