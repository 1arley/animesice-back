import { of } from 'rxjs';
import { Logger } from '@nestjs/common';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;

  function buildContext(request: any): any {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
  }

  function runTest(context: any): Promise<void> {
    return new Promise((resolve) => {
      interceptor
        .intercept(context, { handle: () => of(null) } as any)
        .subscribe({ next: () => resolve(), error: () => resolve() });
    });
  }

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('loga método e caminho sem query string', async () => {
    await runTest(
      buildContext({
        method: 'GET',
        originalUrl: '/api/animes?page=2',
        url: '/api/animes',
      }),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^GET \/api\/animes \d+ms$/),
    );
  });

  it('usa request.url como fallback quando originalUrl não existe', async () => {
    await runTest(buildContext({ method: 'POST', url: '/api/login' }));

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^POST \/api\/login \d+ms$/),
    );
  });

  it('loga apenas a parte do path antes da query string', async () => {
    await runTest(
      buildContext({
        method: 'DELETE',
        originalUrl: '/api/episodes?force=true',
        url: '/api/episodes',
      }),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^DELETE \/api\/episodes \d+ms$/),
    );
  });
});
