import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isIP } from 'node:net';

const TRUST_PROXY_ENABLED = () => process.env.TRUST_PROXY === 'true';

/**
 * ThrottlerGuard ciente de proxy (Cloudflare).
 *
 * O default do @nestjs/throttler usa `req.ip` (socket). Com a API atrás do
 * Cloudflare, TODOS os requests chegariam à origem com o IP do edge da CF —
 * o pool de 120 req/min era compartilhado entre todos os usuários/SSR e
 * estourava em picos (429 → soft-404 + noindex no front).
 *
 * SEGURANÇA: os headers `CF-Connecting-IP` / `x-forwarded-for` são definidos
 * pelo proxy e só podem ser confiados se TODA a entrada obrigatoriamente
 * passou pelo Cloudflare (firewall de 80/443 restrito aos ranges da CF ou
 * Authenticated Origin Pulls). Por isso o guard só os usa quando
 * `TRUST_PROXY=true` — consistente com streaming.controller.ts. Com o flag
 * desligado, volta ao socket IP (comportamento seguro, sem per-cor-request do
 * Cloudflare). Além disso o valor extraído é validado como IP válido.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected override getTracker(req: {
    headers?: Record<string, string>;
    ip?: string;
  }): Promise<string> {
    if (TRUST_PROXY_ENABLED()) {
      const cfIp = req.headers?.['cf-connecting-ip'];
      if (cfIp && isIP(cfIp)) return Promise.resolve(`cf:${cfIp}`);

      const xff = req.headers?.['x-forwarded-for'];
      if (xff) {
        // "client, proxy1, proxy2" — o primeiro é o cliente real, se IP válido.
        const client = xff.split(',')[0]?.trim();
        if (client && isIP(client)) return Promise.resolve(`xff:${client}`);
      }
    }

    return Promise.resolve(`ip:${req.ip ?? 'unknown'}`);
  }
}
