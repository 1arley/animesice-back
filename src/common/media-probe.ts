/**
 * Probe compartilhado de liveness de URL de mídia (.mp4/.m3u8/googlevideo).
 *
 * Extraído de streaming.service.ts p/ reuso pelo Watchtower (validação e
 * reparo de episódios). Reproduz os headers do proxy de mídia: googlevideo
 * valida User-Agent contra o token (cver) — UA errado gera 403 falso.
 *
 * Otimização: URLs googlevideo carregam `expire` (unix). Se expire - agora >
 * 30min, assume viva sem rede; só faz GET (Range bytes=0-0) quando próximo
 * do vencimento ou sem `expire`. Trata 401/403/404/410 como morta; demais
 * (5xx, 429, timeout, erro de rede) como viva, evitando re-extração por
 * problema transitório.
 */

import { assertHostResolvesSafely, isBlockedHostname } from '@/common/ssrf';

const MAX_REDIRECTS = 5;
const LIVENESS_CACHE_TTL_MS = 30_000;

interface LivenessCacheEntry {
  dead: boolean;
  expiresAt: number;
}

const livenessCache = new Map<string, LivenessCacheEntry>();
const livenessInflight = new Map<string, Promise<boolean>>();

/** Remove resultados vencidos; chamado periodicamente pelo scheduler. */
export function purgeExpiredLivenessCache(now = Date.now()): number {
  let removed = 0;
  for (const [url, entry] of livenessCache) {
    if (entry.expiresAt <= now) {
      livenessCache.delete(url);
      removed += 1;
    }
  }
  return removed;
}

/** Visível para testes, evitando estado global entre casos. */
export function clearLivenessCache(): void {
  livenessCache.clear();
  livenessInflight.clear();
}

/** Referer anti-hotlink por host de CDN (mesma regra do proxy de mídia). */
export function refererForMediaUrl(mediaUrl: string): string {
  try {
    const u = new URL(mediaUrl);
    const host = u.hostname.toLowerCase();

    if (/googlevideo\.com$/i.test(host)) {
      return 'https://youtube.googleapis.com/';
    }
    if (/lightspeedst\.net$/i.test(host)) {
      return 'https://animefire.io/';
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'https://meusanimes.blog/';
  }
}

/**
 * Detecta se uma URL de mídia possui assinatura temporária já vencida, sem
 * tocar na rede. Suporta:
 *  - `expire` (unix seconds) — googlevideo/videoplayback
 *  - `X-Amz-Date` (YYYYMMDDTHHMMSSZ) + `X-Amz-Expires` (segundos) — S3/rumble
 *    (assinatura AWS SigV4 expira após X-Amz-Expires desde X-Amz-Date)
 *
 * Retorna true (morta) apenas quando a expiração é DETERMINÍSTICA. Se não
 * houver params de expiração, retorna null (probe de rede decide).
 */
export function signedExpiryDead(url: string): boolean | null {
  try {
    const u = new URL(url);

    const expire = parseInt(u.searchParams.get('expire') ?? '', 10);
    if (Number.isFinite(expire) && expire > 0) {
      return Date.now() / 1000 > expire;
    }

    const amzDate = u.searchParams.get('X-Amz-Date');
    const amzExpires = parseInt(u.searchParams.get('X-Amz-Expires') ?? '', 10);
    if (amzDate && Number.isFinite(amzExpires) && amzExpires > 0) {
      // X-Amz-Date: YYYYMMDDTHHMMSSZ (UTC). Assume 00:00:00 quando faltar T.
      const dateMatch =
        /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/.exec(amzDate);
      if (dateMatch) {
        const [, y, mo, d, h = '00', mi = '00', s = '00'] = dateMatch;
        const signedAt = Date.UTC(
          Number(y),
          Number(mo) - 1,
          Number(d),
          Number(h),
          Number(mi),
          Number(s),
        );
        return Date.now() > signedAt + amzExpires * 1000;
      }
    }
  } catch {
    /* URL malformada: segue para probe de rede */
  }
  return null;
}

/** true = URL morta (precisa re-extração); false = viva ou inconclusivo. */
async function performMediaUrlProbe(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const expire = parseInt(parsed.searchParams.get('expire') ?? '', 10);
    if (Number.isFinite(expire) && expire - Date.now() / 1000 > 1800) {
      return false;
    }
  } catch {
    /* URL malformada: segue para probe de rede */
  }

  // Assinatura temporária vencida (S3/rumble) — morta sem depender da rede.
  const signedDead = signedExpiryDead(url);
  if (signedDead === true) return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const referer = refererForMediaUrl(url);

    let current = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const u = new URL(current);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
      if (isBlockedHostname(u.hostname)) return true;
      await assertHostResolvesSafely(current);

      const res = await fetch(current, {
        method: 'GET',
        headers: {
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          referer,
          origin: referer.replace(/\/$/, ''),
          accept: '*/*',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.5',
          Range: 'bytes=0-0',
        },
        redirect: 'manual',
        signal: controller.signal,
      });

      const location = res.headers.get('location');
      const isRedirect = res.status >= 300 && res.status < 400 && !!location;
      if (isRedirect) {
        try {
          current = new URL(location, current).toString();
          continue;
        } catch {
          return true;
        }
      }

      await res.body?.cancel();
      return (
        res.status === 401 ||
        res.status === 403 ||
        res.status === 404 ||
        res.status === 410
      );
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe com cache curto e single-flight por URL. Resoluções que compartilham a
 * mesma URL reutilizam tanto o resultado recente quanto um probe em andamento.
 */
export function probeMediaUrlDead(url: string): Promise<boolean> {
  const now = Date.now();
  const cached = livenessCache.get(url);
  if (cached) {
    if (cached.expiresAt > now) return Promise.resolve(cached.dead);
    livenessCache.delete(url);
  }

  const existing = livenessInflight.get(url);
  if (existing) return existing;

  const probe = performMediaUrlProbe(url)
    .then((dead) => {
      livenessCache.set(url, {
        dead,
        expiresAt: Date.now() + LIVENESS_CACHE_TTL_MS,
      });
      return dead;
    })
    .finally(() => {
      if (livenessInflight.get(url) === probe) livenessInflight.delete(url);
    });
  livenessInflight.set(url, probe);
  return probe;
}
