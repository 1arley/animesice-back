import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  function buildResponse(): any {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() };
  }

  function makeHost(request: any, response: any): any {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as any;
  }

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  describe('quando recebe um HttpException', () => {
    it('retorna o status e a message do HttpException', () => {
      const response = buildResponse();
      const host = makeHost(
        { method: 'GET', originalUrl: '/admin?token=x', url: '/admin' },
        response,
      );

      filter.catch(
        new HttpException('não permitido', HttpStatus.FORBIDDEN),
        host,
      );

      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          path: '/admin',
          message: 'não permitido',
        }),
      );
    });

    it('extrai message de objeto (array)', () => {
      const response = buildResponse();
      const host = makeHost(
        { method: 'POST', originalUrl: '/x', url: '/x' },
        response,
      );

      filter.catch(
        new HttpException(
          { message: ['campo obrigatório'] },
          HttpStatus.BAD_REQUEST,
        ),
        host,
      );

      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: ['campo obrigatório'],
        }),
      );
    });

    it('extrai message de objeto (string)', () => {
      const response = buildResponse();
      const host = makeHost(
        { method: 'POST', originalUrl: '/x', url: '/x' },
        response,
      );

      filter.catch(new HttpException({ message: 'unauthorized' }, 401), host);

      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, message: 'unauthorized' }),
      );
    });
  });

  describe('quando recebe uma exceção não-HttpException', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('retorna status 500 e Internal server error', () => {
      const response = buildResponse();
      const host = makeHost(
        { method: 'GET', originalUrl: '/y?token=abc', url: '/y' },
        response,
      );

      filter.catch(new Error('boom'), host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          path: '/y',
          message: 'Internal server error',
        }),
      );
    });

    it('loga o stack do erro não-HttpException', () => {
      const host = makeHost(
        { method: 'GET', originalUrl: '/z', url: '/z' },
        buildResponse(),
      );

      filter.catch(new Error('fatal'), host);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('UNCAUGHT on GET /z'),
      );
    });

    it('trata string não-Error como 500', () => {
      const response = buildResponse();
      const host = makeHost(
        { method: 'GET', originalUrl: '/w', url: '/w' },
        response,
      );

      filter.catch('problema', host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 500, path: '/w' }),
      );
    });
  });

  describe('extração de path seguro', () => {
    it('remove query string do path', () => {
      const response = buildResponse();
      const host = makeHost(
        { method: 'GET', originalUrl: '/path?q=1', url: '/path?q=1' },
        response,
      );

      filter.catch(new HttpException('err', 400), host);

      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/path' }),
      );
    });

    it('usa request.url quando originalUrl não existe', () => {
      const response = buildResponse();
      const host = makeHost({ method: 'GET', url: '/fallback?a=1' }, response);

      filter.catch(new HttpException('err', 400), host);

      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/fallback' }),
      );
    });
  });

  describe('erros do body-parser', () => {
    let parserErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      parserErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      parserErrorSpy.mockRestore();
    });

    it('mapeia entity.too.large para 413 em vez de 500', () => {
      const response = buildResponse();
      const host = makeHost(
        {
          method: 'POST',
          originalUrl: '/api/gacha/admin/card-backs',
          url: '/api/gacha/admin/card-backs',
        },
        response,
      );
      const tooLarge: any = new Error('request entity too large');
      tooLarge.type = 'entity.too.large';
      tooLarge.status = 413;

      filter.catch(tooLarge, host);

      expect(response.status).toHaveBeenCalledWith(413);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 413,
          path: '/api/gacha/admin/card-backs',
          message: 'Payload muito grande.',
        }),
      );
      // Erro do cliente nao deve virar "UNCAUGHT".
      expect(parserErrorSpy).not.toHaveBeenCalled();
    });

    it('mantem 500 para erro de parser com type desconhecido', () => {
      const response = buildResponse();
      const host = makeHost(
        { method: 'POST', originalUrl: '/x', url: '/x' },
        response,
      );
      const unknown: any = new Error('boom');
      unknown.type = 'entity.parse.weird';

      filter.catch(unknown, host);

      expect(response.status).toHaveBeenCalledWith(500);
    });
  });

  it('inclui timestamp ISO no response', () => {
    const response = buildResponse();
    const host = makeHost(
      { method: 'GET', originalUrl: '/t', url: '/t' },
      response,
    );

    filter.catch(new HttpException('err', 400), host);

    const jsonArg = response.json.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof jsonArg.timestamp).toBe('string');
    expect(() => new Date(jsonArg.timestamp as string)).not.toThrow();
  });
});
