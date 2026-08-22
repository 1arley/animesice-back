import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { fetchSafeRaw } from '@/common/ssrf';
import {
  ScrapeSource,
  ScrapeEpisodeResult,
  HttpExtractContext,
} from './scrape-source.interface';
import {
  keepVideoUrls,
  extractVideoElements,
  extractAllIframes,
  preferPermanentMediaUrls,
  youtubeEmbedUrl,
} from './extract';

/**
 * Adapter meusanimes.blog / servN.meusdoramas.club (players "Meus Doramas").
 *
 * Cadeia de extração HTTP pura:
 *   1. Página do episódio (meusanimes.blog/e/<anime>-episodio-<n>/) traz
 *      <iframe src="servN.meusdoramas.club/#/video/<tmdb>/<season>/<ep>">.
 *   2. GET /posts/get-video.php?tmdb=&season_number=&episode_number= nesse
 *      servidor -> { videoUrl } onde videoUrl pode ser:
 *      - https://www.blogger.com/video.g?token=...  (player Blogger;
 *          vira .mp4 googlevideo só via Playwright — devolvido em playerTokens)
 *        - https://www.youtube-nocookie.com/embed/<id> (player YouTube;
 *          também vira .mp4 googlevideo via Playwright — playerTokens)
 *        - .mp4/.m3u8 direto (raro)                   -> videos
 *        - URL de seletor "e/?a=..&b=..&c=.."         -> resolve os servidores
 *          (iframe.php?a=/b=/c= -> servN -> get-video.php recursivo).
 *
 * TODOS os hosts (meusanimes.blog, servN.meusdoramas.club) respondem 200 para
 * IPs de datacenter — funciona da VPS. Só o passo Blogger precisa de browser.
 */
@Injectable()
export class MeusanimesScrapeSource implements ScrapeSource {
  readonly id = 'meusanimes';

  private readonly UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  private readonly IFRAME_RE =
    /serv(\d+)\.meusdoramas\.club\/#\/video\/(\d+)\/(\d+)\/(\d+)/i;

  private readonly PICKER_RE = /\/(e\/)?\?a=\d+\/\d+\/\d+/i;

  private readonly IFRAME_PHP_RE =
    /location\.href='(iframe\.php\?[abc]=\d+\/\d+\/\d+\/?)'/gi;

  supports(url: string): boolean {
    return /meusanimes\.blog|meusdoramas\.club/i.test(url);
  }

  async extractHttp(ctx: HttpExtractContext): Promise<ScrapeEpisodeResult> {
    const visited = new Set<string>();
    const videos: string[] = [];
    const playerTokens: string[] = [];

    let pageHtml: string;
    try {
      pageHtml = await this.get(ctx.episodeUrl, ctx.ua);
    } catch (err) {
      throw new Error(
        `meusanimes: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const iframe = pageHtml.match(this.IFRAME_RE);
    if (iframe) {
      await this.resolveServer(
        `serv${iframe[1]}.meusdoramas.club`,
        iframe[2]!,
        iframe[3]!,
        iframe[4]!,
        ctx.ua,
        visited,
        videos,
        playerTokens,
      );
    }

    return {
      videos: [...new Set(videos)],
      iframes: [],
      cloudflare: false,
      playerTokens: [...new Set(playerTokens)],
    };
  }

  /**
   * Consulta get-video.php de um servidor e classifica o resultado.
   * Se vier seletor de servidores (e/?a=), resolve cada iframe.php recursivamente.
   */
  private async resolveServer(
    host: string,
    tmdb: string,
    season: string,
    episode: string,
    ua: string,
    visited: Set<string>,
    videos: string[],
    playerTokens: string[],
  ): Promise<void> {
    const key = `${host}/${tmdb}/${season}/${episode}`;
    if (visited.has(key)) return;
    visited.add(key);

    const json = await this.get(
      `https://${host}/posts/get-video.php?tmdb=${tmdb}&season_number=${season}&episode_number=${episode}`,
      ua,
      `https://${host}/`,
    );

    let videoUrl: unknown;
    try {
      videoUrl = (JSON.parse(json) as { videoUrl?: unknown }).videoUrl;
    } catch {
      return;
    }
    if (typeof videoUrl !== 'string' || !videoUrl) return;

    if (/blogger\.com\/video\.g\?token=/i.test(videoUrl)) {
      playerTokens.push(videoUrl);
      return;
    }

    // Player YouTube: youtube-nocookie.com/embed/<id> (ou youtube.com/embed,
    // youtu.be). Não é .mp4/.m3u8 direto e NÃO é resolvível p/ .mp4 server-side
    // (YouTube bloqueia IPs datacenter com LOGIN_REQUIRED). O embed funciona no
    // browser do usuário via iframe — devolvido em playerTokens p/ o streaming
    // servir como embed (getSource devolve src=<embed>).
    const yt = youtubeEmbedUrl(videoUrl);
    if (yt) {
      playerTokens.push(yt);
      return;
    }

    // Player próprio MeuDoramas: video.meusdoramas.club/embed/<uuid> é página
    // JWPlayer com o config embutido no HTML — extrai o .mp4/.m3u8 direto.
    if (/video\.meusdoramas\.club\/embed\//i.test(videoUrl)) {
      try {
        const embedHtml = await this.get(
          videoUrl,
          ua,
          `${new URL(videoUrl).origin}/`,
        );
        const files = [
          ...embedHtml.matchAll(
            /"file":\s*"([^"]+\.(?:mp4|m3u8)(?:\?[^"]*)?)"/gi,
          ),
        ]
          .map((m) => m[1]!.replace(/\\\//g, '/'))
          .filter((f) => /^https?:\/\//i.test(f));
        // Prefere URLs permanentes (R2/CDN pública) a tokens S3 temporários.
        for (const f of preferPermanentMediaUrls(files)) {
          if (!videos.includes(f)) videos.push(f);
        }
      } catch {
        /* embed irresolvível — segue sem vídeo */
      }
      return;
    }

    if (/\.(mp4|m3u8)($|\?|#)/i.test(videoUrl)) {
      videos.push(videoUrl);
      return;
    }

    // Seletor de servidores: "…/e/?a=X&b=Y&c=Z" -> pagina com iframe.php?x=...
    if (this.PICKER_RE.test(videoUrl)) {
      try {
        const u = new URL(videoUrl);
        const pickerHost = u.host;
        const pickerHtml = await this.get(
          `https://${pickerHost}${u.pathname}${u.search}`,
          ua,
          `https://${pickerHost}/`,
        );
        for (const [, iframePath] of pickerHtml.matchAll(this.IFRAME_PHP_RE)) {
          const iframeHtml = await this.get(
            `https://${pickerHost}/e/${iframePath}`,
            ua,
            `https://${pickerHost}/e/`,
          );
          const m = iframeHtml.match(this.IFRAME_RE);
          if (m) {
            await this.resolveServer(
              `serv${m[1]}.meusdoramas.club`,
              m[2]!,
              m[3]!,
              m[4]!,
              ua,
              visited,
              videos,
              playerTokens,
            );
          }
        }
      } catch {
        /* seletor irresolvível — segue sem vídeo */
      }
    }
  }

  private async get(
    url: string,
    ua: string,
    referer?: string,
  ): Promise<string> {
    const headers: Record<string, string> = {
      'user-agent': ua,
      'accept-language': 'pt-BR,pt;q=0.9',
      accept:
        'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    };
    if (referer) headers.referer = referer;
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

  /** Fallback Playwright (fluxo generico de extração da pagina). */
  async extract(page: Page): Promise<ScrapeEpisodeResult> {
    const all = await extractVideoElements(page);
    const iframes = await extractAllIframes(page);
    return { videos: keepVideoUrls(all), iframes, cloudflare: false };
  }
}
