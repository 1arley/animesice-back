import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

@Injectable()
export class BigIntSerializationInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        const serialized = JSON.stringify(value, (_key, nested: unknown) =>
          typeof nested === 'bigint' ? nested.toString() : nested,
        );
        return serialized === undefined
          ? value
          : (JSON.parse(serialized) as unknown);
      }),
    );
  }
}
