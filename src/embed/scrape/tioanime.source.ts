import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { fetchSafeRaw } from '@/common/ssrf';
import {
  ScrapeSource,
  ScrapeEpisodeResult,
  HttpExtractContext,
} from './scrape-source.interface';
import {
  extractVideoElements,
  extractAllIframes,
  keepVideoUrls,
} from './extract';

/**
 * Regex para extrair o JSON de videos do HTML do tioanime.com.
 * Padrão: var videos = [["nome","url",0,0],...];
 * Os slashes sao escapados como \/ no JSON original.
 */
const VIDEOS_JSON_RE = /var\s+videos\s*=\s*(\[[\s\S]*?\])\s*;/;

/**
 * Hosts de embed que sabemos resolver para .mp4 server-side (via fetch).
 * Outros ficam em playerTokens para resolucao via Playwright no browser.
 */
const DIRECT_VIDEO_HOSTS = [
  /^(?:[\w-]+\.)*embedsb\.com$/i,
  /^(?:[\w-]+\.)*yourupload\.com$/i,
  /^(?:[\w-]+\.)*ok\.ru$/i,
  /^(?:[\w-]+\.)*my\.mail\.ru$/i,
];

/**
 * Adapter tioanime.com (site de anime em espanhol).
 *
 * O site retorna multiple fontes de video inline no HTML como JSON:
 *   var videos = [["nome","url",flags,0],...]
 *
 * Fontes incluem: StreamSB, Mega, Okru, YourUpload, Amus, Mepu, Netu, Maru.
 *
 * Caminho HTTP puro (extractHttp):
 *   1. GET /ver/<slug>-<ep> -> HTML com var videos = [...]
 *   2. Parse JSON, classifica cada fonte:
 *      - .mp4/.m3u8 direto -> videos
 *      - embed URLs conhecidos -> playerTokens (resoluve via Playwright)
 *      - URLs de hosts desconhecidos -> playerTokens (fallback)
 *
 * Funciona de IPs de datacenter (sem Cloudflare).
 */
@Injectable()
export class TioanimeScrapeSource implements ScrapeSource {
  readonly id = 'tioanime';

  private readonly UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  supports(url: string): boolean {
    return /tioanime\.com/i.test(url);
  }

  /**
   * Constrói a URL de um episódio no tioanime.com.
   * Padrão: tioanime.com/ver/<animeSlug>-<episodeNumber>
   *
   * Nota: o tioanime usa slugs em japones/romanji, nao os mesmos slugs
   * do animefire/meusanimes. Este metodo gera uma URL candidata; o
   * scraping real depende de a URL existir no site.
   */
  episodeUrl(animeSlug: string, episodeNumber: number): string {
    return `https://tioanime.com/ver/${animeSlug}-${episodeNumber}`;
  }

  async extractHttp(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult> {
    let html: string;
    try {
      html = await this.get(ctx.episodeUrl, ctx.ua);
    } catch (err) {
      throw new Error(
        `tioanime: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    const match = html.match(VIDEOS_JSON_RE);
    if (!match || !match[1]) {
      throw new Error('tioanime: var videos nao encontrado no HTML.');
    }

    // Unescape \/ para / (JSON do tioanime escapa slashes)
    const raw = match[1].replace(/\\\//g, '/');

    let entries: Array<[string, string, number, number]>;
    try {
      entries = JSON.parse(raw) as Array<[string, string, number, number]>;
    } catch {
      throw new Error('tioanime: falha ao parsear JSON de videos.');
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('tioanime: array de videos vazio.');
    }

    const videos: string[] = [];
    const playerTokens: string[] = [];

    for (const [, url] of entries) {
      if (!url || typeof url !== 'string') continue;

      // .mp4/.m3u8 direto
      if (/\.(mp4|m3u8)($|\?|#)/i.test(url)) {
        if (!videos.includes(url)) videos.push(url);
        continue;
      }

      // Embed URLs que sabemos que funcionam como iframe no player
      if (DIRECT_VIDEO_HOSTS.some((re) => re.test(url))) {
        if (!playerTokens.includes(url)) playerTokens.push(url);
        continue;
      }

      // Demais embeds (Amus, Mepu, Netu, Mega, etc.)
      if (!playerTokens.includes(url)) playerTokens.push(url);
    }

    if (videos.length === 0 && playerTokens.length === 0) {
      throw new Error(
        `tioanime: nenhuma fonte util encontrada em ${entries.length} entradas.`,
      );
    }

    return {
      videos,
      iframes: [],
      cloudflare: false,
      playerTokens,
    };
  }

  private async get(url: string, ua: string): Promise<string> {
    const headers: Record<string, string> = {
      'user-agent': ua,
      'accept-language': 'es-ES,es;q=0.9,pt-BR;q=0.8',
      accept:
        'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    };
    let response: Response;
    let dispatcher: import('undici').Dispatcher;
    try {
      ({ response, dispatcher } = await fetchSafeRaw(url, { headers }, 15_000));
    } catch (err) {
      const cause = err instanceof Error ? err.cause : undefined;
      throw new Error(
        `fetch failed para ${url}: ${err instanceof Error ? err.message : String(err)}${cause ? ` (causa: ${cause instanceof Error ? cause.message : JSON.stringify(cause)})` : ''}`,
        { cause: err },
      );
    }
    try {
      if (!response.ok) {
        throw new Error(`${url} retornou ${response.status}`);
      }
      return await response.text();
    } finally {
      await dispatcher.close();
    }
  }

  /** Fallback Playwright (extracao generica). */
  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const all = await extractVideoElements(page);
    const iframes = await extractAllIframes(page);
    return { videos: keepVideoUrls(all), iframes, cloudflare: false };
  }
}
