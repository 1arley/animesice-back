import { firstValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { CatalogCacheInterceptor } from '@/anime/catalog-cache.interceptor';

function ctx(method: string, originalUrl: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, originalUrl }) }),
  } as unknown as ExecutionContext;
}

function handler(value: unknown): { ch: CallHandler; calls: () => number } {
  let n = 0;
  const ch: CallHandler = { handle: () => ((n += 1), of(value)) };
  return { ch, calls: () => n };
}

describe('CatalogCacheInterceptor', () => {
  const interceptor = new CatalogCacheInterceptor();

  it('serve do cache na 2ª chamada da MESMA url (não re-executa o handler)', async () => {
    const url = '/api/anime?page=1&uniq=a';
    const h = handler({ data: [1] });
    const first = await firstValueFrom(
      interceptor.intercept(ctx('GET', url), h.ch),
    );
    const second = await firstValueFrom(
      interceptor.intercept(ctx('GET', url), h.ch),
    );
    expect(first).toEqual({ data: [1] });
    expect(second).toEqual({ data: [1] });
    expect(h.calls()).toBe(1); // 2ª veio do cache
  });

  it('NÃO cruza cache entre query de adulto e query normal (anti-leak)', async () => {
    // URLs distintas (uma com includeHentai) => chaves distintas => cada uma
    // executa o handler; a resposta filtrada nunca atende o pedido adulto.
    const normalUrl = '/api/anime?uniq=b';
    const adultUrl = '/api/anime?includeHentai=1&uniq=b';
    const normal = handler({ adult: false });
    const adult = handler({ adult: true });

    await firstValueFrom(
      interceptor.intercept(ctx('GET', normalUrl), normal.ch),
    );
    const servedToAdult = await firstValueFrom(
      interceptor.intercept(ctx('GET', adultUrl), adult.ch),
    );

    expect(servedToAdult).toEqual({ adult: true }); // não recebeu a resposta normal
    expect(normal.calls()).toBe(1);
    expect(adult.calls()).toBe(1);
  });
});
