import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TtlCache } from '@/common/ttl-cache';

/**
 * Cache de leitura em-processo p/ GETs públicos de catálogo (sem dados por
 * usuário). Derruba a leitura repetida do Postgres via pooler do Supabase que o
 * SSR (Vercel) dispara a cada page-view — o maior multiplicador de egress.
 *
 * Chave = método + URL completa (query incluída), então filtros de busca e o
 * opt-in adulto (`includeHentai`, que é só query param) já caem em chaves
 * distintas: a resposta nunca vaza entre audiência normal e adulta.
 */
@Injectable()
export class CatalogCacheInterceptor implements NestInterceptor {
  private static readonly cache = new TtlCache<unknown>(120_000, 500);

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = `${req.method} ${req.originalUrl}`;
    const hit = CatalogCacheInterceptor.cache.get(key);
    if (hit !== undefined) return of(hit);
    return next.handle().pipe(
      tap((data) => {
        if (data !== undefined) {
          CatalogCacheInterceptor.cache.set(key, data);
        }
      }),
    );
  }
}
