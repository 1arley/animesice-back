import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import type { LaunchOptions } from 'playwright';

/** Chromium precisa receber o proxy e a autenticação explicitamente. */
export function playwrightProxy(): LaunchOptions['proxy'] {
  const env = process.env;
  const raw =
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return {
      server: url.origin,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      bypass: (
        env.NO_PROXY ||
        env.no_proxy ||
        'localhost,127.0.0.1,::1,*.local'
      )
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((host) => (host === '::1' ? '[::1]' : host))
        .join(','),
    };
  } catch {
    throw new Error('Proxy HTTP/HTTPS inválido para o Chromium.');
  }
}

/**
 * Configura proxy outbound para TODOS os fetch() do processo (scrape de
 * fontes, re-extração, proxy de mídia, proxyHtml) via env vars padrão:
 *
 *   HTTPS_PROXY / HTTP_PROXY  ex: http://user:pass@host:port
 *   NO_PROXY                  ex: localhost,127.0.0.1,*.internal
 *
 * Sem proxy configurado, nada muda (fetch direto).
 * Requests com proteção SSRF usam dispatcher próprio com DNS pinado e, por
 * segurança, não passam por este proxy (o proxy re-resolveria o hostname).
 *
 * POR QUE: CDNs/Cloudflare de fontes piratas bloqueiam IPs de datacenter
 * (403). Com um proxy residencial configurado, o egress do backend sai pelo
 * IP residencial — re-extração e stream saem pelo MESMO IP, o que também
 * satisfaz o IP-vinculo dos tokens .mp4 (lightspeedst.net, googlevideo).
 */
export function setupOutboundProxy(): void {
  const env = process.env;
  const proxyUrl =
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;

  if (!proxyUrl) {
    return;
  }

  // EnvHttpProxyAgent não tem NO_PROXY default; garante localhost sempre
  // direto (healthcheck/infra interna não pode passar pelo proxy).
  if (!env.NO_PROXY && !env.no_proxy) {
    env.NO_PROXY = 'localhost,127.0.0.1,::1,*.local';
  }

  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    const masked = proxyUrl.replace(/\/\/[^@/]+@/, '//***@');
    console.log(
      `[PROXY] outbound HTTP/HTTPS via ${masked} (NO_PROXY=${env.NO_PROXY})`,
    );
  } catch (err) {
    console.warn(
      '[PROXY] falha ao configurar proxy outbound:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
