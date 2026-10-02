import { ServiceUnavailableException } from '@nestjs/common';
import { of } from 'rxjs';
import { MaintenanceInterceptor } from '@/common/interceptors/maintenance.interceptor';

describe('MaintenanceInterceptor', () => {
  const original = process.env.MAINTENANCE;

  afterEach(() => {
    if (original === undefined) delete process.env.MAINTENANCE;
    else process.env.MAINTENANCE = original;
  });

  it('bloqueia a requisição com 503 quando MAINTENANCE=true', () => {
    process.env.MAINTENANCE = 'true';
    const interceptor = new MaintenanceInterceptor();
    const next = { handle: () => of({ ok: true }) };

    expect(() => interceptor.intercept({} as never, next)).toThrow(
      ServiceUnavailableException,
    );
    expect(() => interceptor.intercept({} as never, next)).toThrow(
      'Sistema em manutenção.',
    );
  });

  it('deixa a requisição passar quando MAINTENANCE não é "true"', (done) => {
    process.env.MAINTENANCE = 'false';
    const interceptor = new MaintenanceInterceptor();
    const next = { handle: () => of({ ok: true }) };

    interceptor.intercept({} as never, next).subscribe((value) => {
      expect(value).toEqual({ ok: true });
      done();
    });
  });

  it('deixa a requisição passar quando MAINTENANCE não está definida', (done) => {
    delete process.env.MAINTENANCE;
    const interceptor = new MaintenanceInterceptor();
    const next = { handle: () => of({ ok: true }) };

    interceptor.intercept({} as never, next).subscribe((value) => {
      expect(value).toEqual({ ok: true });
      done();
    });
  });
});
