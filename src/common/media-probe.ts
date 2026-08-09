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

/** true = URL morta (precisa re-extração); false = viva ou inconclusivo. */
export async function probeMediaUrlDead(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const expire = parseInt(parsed.searchParams.get('expire') ?? '', 10);
    if (Number.isFinite(expire) && expire - Date.now() / 1000 > 1800) {
      return false;
    }
  } catch {
    /* URL malformada: segue para probe de rede */
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const referer = refererForMediaUrl(url);
    const res = await fetch(url, {
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
      redirect: 'follow',
      signal: controller.signal,
    });
    await res.body?.cancel();
    return (
      res.status === 401 ||
      res.status === 403 ||
      res.status === 404 ||
      res.status === 410
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
