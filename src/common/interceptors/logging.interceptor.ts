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
      tap({
        next: () => {
          this.log(context, now, false);
        },
        error: () => {
          this.log(context, now, true);
        },
      }),
    );
  }

  private log(context: ExecutionContext, now: number, failed: boolean): void {
    const req = context.switchToHttp().getRequest<Request>();
    const safePath = (req.originalUrl ?? req.url).split('?')[0];
    const elapsed = Date.now() - now;
    if (failed) {
      this.logger.error(`${req.method} ${safePath} ${elapsed}ms ERROR`);
    } else {
      this.logger.log(`${req.method} ${safePath} ${elapsed}ms`);
    }
  }
}
