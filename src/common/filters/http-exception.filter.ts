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

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Diagnóstico: loga stack de erros não-HttpException (500 engolidos).
    // Path sem query string — tokens em ?token= não vazam para logs.
    const safePath = (request.originalUrl ?? request.url).split('?')[0];
    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `UNCAUGHT on ${request.method} ${safePath}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    const errorResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const message =
      typeof errorResponse === 'object' &&
      errorResponse !== null &&
      'message' in errorResponse
        ? (errorResponse as { message: unknown }).message
        : errorResponse;

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: safePath,
      message,
    });
  }
}
