/**
 * Probe compartilhado de liveness de URL de mídia (.mp4/.m3u8/googlevideo).
 *
 * Extraído de streaming.service.ts p/ reuso pelo Watchtower (validação e
 * reparo de episódios). Reproduz os headers do proxy de mídia: googlevideo
 * valida User-Agent contra o token (cver) — UA errado gera 403 falso.
 *
 * Otimização: URLs assinadas com expiração determinística são decididas
 * localmente. Enquanto o timestamp estiver no futuro a URL é considerada viva;
 * depois dele é considerada morta. Isso evita acrescentar até 5s de rede a
 * cada abertura quando um token googlevideo ainda válido está perto do fim.
 * URLs sem expiração conhecida usam GET (Range bytes=0-0).
 * Trata 401/403/404/410 como morta; demais
 * (5xx, 429, timeout, erro de rede) como viva, evitando re-extração por
 * problema transitório.
 */

import { pinnedDispatcher, resolveSafeUrl } from '@/common/ssrf';
import { refererForMediaUrl } from '@/common/url-utils';

const MAX_REDIRECTS = 5;
const LIVENESS_CACHE_TTL_MS = 1_800_000; // 30 min — reduz probes de rede em 6x

interface LivenessCacheEntry {
  dead: boolean;
  expiresAt: number;
}

const livenessCache = new Map<string, LivenessCacheEntry>();
const livenessInflight = new Map<string, Promise<boolean>>();
const LIVENESS_CACHE_MAX_ENTRIES = 500;

/** Remove resultados vencidos e evicta por tamanho; chamado periodicamente pelo scheduler. */
export function purgeExpiredLivenessCache(now = Date.now()): number {
  let removed = 0;
  for (const [url, entry] of livenessCache) {
    if (entry.expiresAt <= now) {
      livenessCache.delete(url);
      removed += 1;
    }
  }
  // Eviction por tamanho — evita crescimento indefinido de memória.
  if (livenessCache.size > LIVENESS_CACHE_MAX_ENTRIES) {
    const entries = [...livenessCache.entries()];
    // Ordena por expiresAt asc (mais velho primeiro) e remove os excedentes.
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = entries.slice(
      0,
      entries.length - LIVENESS_CACHE_MAX_ENTRIES,
    );
    for (const [key] of toRemove) {
      livenessCache.delete(key);
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

    const expire = unixExpiry(u);
    if (expire !== null) {
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

/** `expire` unix válido; null para ausente, inválido ou não positivo. */
function unixExpiry(url: URL): number | null {
  const raw = url.searchParams.get('expire');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** true = URL morta (precisa re-extração); false = viva ou inconclusivo. */
async function performMediaUrlProbe(
  url: string,
  forceNetwork = false,
): Promise<boolean> {
  // Assinaturas temporárias podem ser decididas sem rede: true = vencida,
  // false = ainda válida. Só null (sem expiração conhecida) exige probe.
  const signedDead = signedExpiryDead(url);
  if (!forceNetwork && signedDead !== null) return signedDead;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const referer = refererForMediaUrl(url);

    let current = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const resolution = await resolveSafeUrl(current);
      const dispatcher = pinnedDispatcher(resolution);

      const res = await fetch(resolution.url, {
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
        dispatcher,
      });

      const location = res.headers.get('location');
      const isRedirect = res.status >= 300 && res.status < 400 && !!location;
      if (isRedirect) {
        await res.body?.cancel();
        await dispatcher.close();
        try {
          current = new URL(location, current).toString();
          continue;
        } catch {
          return true;
        }
      }

      await res.body?.cancel();
      await dispatcher.close();
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
export function probeMediaUrlDead(
  url: string,
  forceNetwork = false,
): Promise<boolean> {
  const now = Date.now();
  const cacheKey = forceNetwork ? `network:${url}` : url;
  const cached = livenessCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > now) return Promise.resolve(cached.dead);
    livenessCache.delete(cacheKey);
  }

  const existing = livenessInflight.get(cacheKey);
  if (existing) return existing;

  const probe = performMediaUrlProbe(url, forceNetwork)
    .then((dead) => {
      livenessCache.set(cacheKey, {
        dead,
        expiresAt: Date.now() + LIVENESS_CACHE_TTL_MS,
      });
      return dead;
    })
    .finally(() => {
      if (livenessInflight.get(cacheKey) === probe) {
        livenessInflight.delete(cacheKey);
      }
    });
  livenessInflight.set(cacheKey, probe);
  return probe;
}
