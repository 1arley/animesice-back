/**
 * Utilitários compartilhados de URL para mídia.
 *
 * Centraliza a lógica de Referer anti-hotlinking por CDN, eliminando
 * duplicação entre streaming.service.ts, media-probe.ts e scrape.service.ts.
 */

/** Referer anti-hotlink por host de CDN. */
function refererForMediaUrlRaw(mediaUrl: string): string | null {
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
    return null;
  }
}

/**
 * Resolve o Referer correto para a URL de mídia com base no host da CDN.
 * - googlevideo.com (vindo de Blogger/YouTube): exige Referer youtube.googleapis.com
 * - lightspeedst.net (vindo de animefire): exige Referer animefire.io
 * - default: origem da própria URL, ou `fallback` se a URL for inválida.
 */
export function refererForMediaUrl(
  mediaUrl: string,
  fallback = 'https://animefire.io/',
): string {
  return refererForMediaUrlRaw(mediaUrl) ?? fallback;
}

/**
 * Resolve o Referer para uma URL de mídia, usando a origem da página do
 * episódio como fallback quando a CDN não é reconhecida. Usado pelo
 * scrape.service.ts que precisa do contexto da página fonte.
 */
export function refererForMediaUrlWithFallback(
  mediaUrl: string,
  episodeUrl: string,
): string {
  const known = refererForMediaUrlRaw(mediaUrl);
  if (known) return known;
  try {
    const u = new URL(episodeUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'https://animefire.io/';
  }
}
