import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

/**
 * Configura proxy outbound para TODOS os fetch() do processo (scrape de
 * fontes, re-extração, proxy de mídia, proxyHtml) via env vars padrão:
 *
 *   HTTPS_PROXY / HTTP_PROXY  ex: http://user:pass@host:port
 *   NO_PROXY                  ex: localhost,127.0.0.1,*.internal
 *
 * Sem proxy configurado, nada muda (fetch direto).
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
