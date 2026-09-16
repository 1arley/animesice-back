import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class MaintenanceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (process.env.MAINTENANCE === 'true') {
      throw new ServiceUnavailableException('Sistema em manutenção.');
    }
    return next.handle();
  }
}
