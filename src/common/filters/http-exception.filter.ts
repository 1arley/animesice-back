import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Prisma conhecido fora de serviços: evita 500 genérico sem mudar
    // contratos existentes (serviços que já mapeiam continuam vencendo).
    const prismaMapped = mapPrismaError(exception);
    const httpException =
      exception instanceof HttpException ? exception : prismaMapped;

    const status = httpException
      ? httpException.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Diagnóstico: loga stack de erros não-HttpException (500 engolidos).
    // Path sem query string — tokens em ?token= não vazam para logs.
    const safePath = (request.originalUrl ?? request.url).split('?')[0];
    if (!httpException) {
      this.logger.error(
        `UNCAUGHT on ${request.method} ${safePath}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    const errorResponse = httpException
      ? httpException.getResponse()
      : 'Internal server error';

    const message =
      typeof errorResponse === 'object' &&
      errorResponse !== null &&
      'message' in errorResponse
        ? errorResponse.message
        : errorResponse;

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: safePath,
      message,
    });
  }
}

function prismaCode(exception: unknown): string | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const code = (exception as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

// Mapeia apenas códigos estáveis do Prisma para 4xx sem vazar detalhe interno.
// P2002 conflito de unicidade, P2025 registro ausente em corrida,
// P2003/P2014 violação de FK/relação.
function mapPrismaError(exception: unknown): HttpException | null {
  switch (prismaCode(exception)) {
    case 'P2002':
      return new HttpException('Conflito de unicidade.', HttpStatus.CONFLICT);
    case 'P2025':
      return new HttpException(
        'Registro não encontrado.',
        HttpStatus.NOT_FOUND,
      );
    case 'P2003':
    case 'P2014':
      return new HttpException('Referência inválida.', HttpStatus.BAD_REQUEST);
    default:
      return null;
  }
}
