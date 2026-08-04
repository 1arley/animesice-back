import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const req = context.switchToHttp().getRequest<Request>();
        this.logger.log(`${req.method} ${req.url} ${Date.now() - now}ms`);
      }),
    );
  }
}
