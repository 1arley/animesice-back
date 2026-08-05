// src/embed/scrape/scrape.service.ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright';
import type { Page, BrowserContext, Browser } from 'playwright';
import { ScrapeSource, ScrapeEpisodeResult } from './scrape-source.interface';
import { AnimefireScrapeSource } from './animefire.source';
import { AnimesonlineccScrapeSource } from './animesonlinecc.source';
import { MeusanimesScrapeSource } from './meusanimes.source';
import { PrismaService } from '@/prisma/prisma.service';

/** Subconjunto do DOM usado no diagnostico do scraping. */
interface EmbedDocument {
  querySelectorAll(selector: string): Iterable<{
    src?: string;
    tagName?: string;
    className?: string;
  }>;
}

/**
 * Envolve URLs de midia externas (.mp4/.m3u8/videoplayback) em proxy de midia
 * interno (/embed/media?url=) para:
 *  - injetar Referer/Origin anti-hotlinking (lightspeedst.net, googlevideo).
 *  - consumir pelo IP do backend (mesmo que fez o scrape) -> resolve IP-vinculo
 *    dos tokens.
 *  - servir pelo mesmo dominio do backend (sem CORS / Connection Refused).
 * URLs relativas/nulas/do proprio backend sao mantidas intactas.
 */
/**
 * Origem do site fonte (ex: https://animefire.io) injetada como Referer/Origin
 * no proxy de mídia p/ contornar anti-hotlinking das CDNs (lightspeedst.net
 * valida Referer contra animefire.io; googlevideo valida contra blogger.com).
 */
function originOf(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function wrapMediaUrl(raw: string, episodeUrl: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  const ref = originOf(episodeUrl);
  const refererParam = ref ? `&referer=${encodeURIComponent(ref)}` : '';
  const apiPrefix = process.env.API_PREFIX || 'api';
  return `/${apiPrefix}/embed/media?url=${encodeURIComponent(trimmed)}${refererParam}`;
}

/**
 * UA desktop real (nao bot conhecido) para simulacao de navegador humano.
 * Cloudflare bloqueia user-agents de bot; se detectar "Just a moment", aborta sem bypass.
 */
const UA_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Marcadores de tela de desafio do Cloudflare no <title>. */
const CLOUDFLARE_MARKERS = ['just a moment', 'checking your browser'];

/** Seletores genéricos de player para aguardar anexação. */
const PLAYER_SELECTORS = [
  'iframe[src*="player"]',
  'iframe[src*="blogger.com/video"]',
  'iframe[src*="youtube.com/embed"]',
  'iframe[src*="/embed/"]',
  'video',
  '.video-player',
  '[data-video]',
].join(', ');

/**
 * ScrapeService — extração técnica de URL .mp4/.m3u8 + iframes de episódio,
 * multi-fonte via Playwright (chromium headless).
 *
 * Reusa a logica do `scrape_animefire/scrape.js` em TypeScript/Nest,
 * generalizada p/ animefire / animesonlinecc / meusanimes.
 *
 * AVISO DE IP-VINCULO (CRITICO):
 *   Tokens .mp4 de CDNs pirates frequentemente VINCULAM ao IP. O IP que abriu
 *   a pagina (IP de saida do backend) deve ser o MESMO IP que consome o video.
 *   Local (scraper e usuario na mesma maquina) funciona. Em prod com backend em
 *   host distinto do usuario, o CDN rejeita (403/expire).
 *
 * NAO contorna Cloudflare bot-detection (sem stealth/patches). Se bloqueado,
 * lanca ServiceUnavailableException.
 *
 * ESTUDO/AMBIENTE ISOLADO: nao redistribui o conteudo extraido.
 */
@Injectable()
export class ScrapeService {
  private readonly sources: ScrapeSource[];
  private activeScrapes = 0;
  private readonly MAX_CONCURRENT_SCRAPES = 2;

  constructor(
    animefire: AnimefireScrapeSource,
    animesonlinecc: AnimesonlineccScrapeSource,
    meusanimes: MeusanimesScrapeSource,
    private readonly prisma: PrismaService,
  ) {
    this.sources = [animefire, animesonlinecc, meusanimes];
  }

  /**
   * Abre a pagina de um episodio no chromium headless e extrai URLs de video.
   * @param episodeUrl URL absoluta do episodio.
   * @param sourceId opcional força um adapter (animefire/animesonlinecc/meusanimes);
   *                 sem source, auto-detecta pelo host.
   */
  async scrapeEpisodeVideo(
    episodeUrl: string,
    sourceId?: string,
  ): Promise<ScrapeEpisodeResult> {
    const source = this.resolveSource(episodeUrl, sourceId);

    // Limita a concorrência de chromium headless (memória/CPU do host).
    if (this.activeScrapes >= this.MAX_CONCURRENT_SCRAPES) {
      throw new ServiceUnavailableException(
        'Muitas extrações simultâneas. Tente novamente em instantes.',
      );
    }
    this.activeScrapes += 1;

    // Caminho HTTP puro: se o adapter implementa extractHttp, pula o Playwright.
    // Relevante p/ animefire (extraível por fetch, sem Cloudflare/browser em prod).
    if (typeof source.extractHttp === 'function') {
      try {
        const raw = await source.extractHttp({ episodeUrl, ua: UA_DESKTOP });
        return {
          videos: raw.videos.map((v) => wrapMediaUrl(v, episodeUrl)),
          iframes: [],
          cloudflare: false,
        };
      } finally {
        this.activeScrapes -= 1;
      }
    }

    let browser: Browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      this.activeScrapes -= 1;
      throw err;
    }
    const context = await browser.newContext({
      userAgent: UA_DESKTOP,
      locale: 'pt-BR',
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();

    // Listener de requests ANTES do goto: captura stream gerado por qualquer
    // JS que rodar, mesmo antes de tentarmos clicar (alguns clones disparan o
    // videoplayback no load). Diagnostico: logar todos os hosts de midia vistos.
    const allMediaRequests: string[] = [];
    page.on('request', (req) => {
      const u = req.url();
      if (
        /videoplayback|googlevideo|\.m3u8|\.mp4($|\?|#)|blogger\.com\/video/i.test(
          u,
        )
      ) {
        allMediaRequests.push(u);
      }
    });

    try {
      await page.goto(episodeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      // Diagnostico: titulo da pagina (detecta paywall/redirect/erro).

      console.log(
        '[SCRAPE] goto OK url=',
        episodeUrl,
        'title=',
        await page.title().catch(() => '?'),
      );

      // Cloudflare: detecta tela de desafio e aborta (sem bypass).
      if (await this.detectCloudflare(page)) {
        throw new ServiceUnavailableException(
          'Cloudflare bloqueou a página do episódio (não contornamos bot-detection).',
        );
      }

      // Aguarda player/iframe/video aparecer.
      await this.waitPlayer(page);
      // Player é injetado via JS após DOM; espera extra p/ currentSrc popular.
      await page.waitForTimeout(6000);

      // Diagnostico: se ja capturamos requests de midia no load, usa direto.

      console.log(
        '[SCRAPE] pre-extract media requests:',
        allMediaRequests.length,
        JSON.stringify(allMediaRequests.slice(0, 5)),
      );

      // Diagnostico: dump dos iframes e botoes de play candidatos.
      const diagIframes = await page
        .evaluate(() => {
          const d = (globalThis as unknown as { document: EmbedDocument })
            .document;
          return Array.from(d.querySelectorAll('iframe[src]')).map(
            (e) => e.src,
          );
        })
        .catch(() => []);
      const diagButtons = await page
        .evaluate(() => {
          const d = (globalThis as unknown as { document: EmbedDocument })
            .document;
          const all = Array.from(
            d.querySelectorAll(
              '[class*="play" i],[aria-label*="play" i],[aria-label*="reproduzir" i],.ytp-cued-thumbnail-overlay,.ytp-large-play-button',
            ),
          );
          return all
            .slice(0, 10)
            .map((e) => ({ tag: e.tagName, cls: String(e.className) }));
        })
        .catch(() => []);

      console.log('[SCRAPE] iframes:', JSON.stringify(diagIframes));

      console.log(
        '[SCRAPE] botoes-play-candidatos:',
        JSON.stringify(diagButtons),
      );

      const result = await source.extract(page);

      // Se o source nao extraiu video direto, tenta a estrategia generica:
      // clicar no botao de play (Blogger/Dooplay) e interceptar o stream.
      let videos = result.videos;
      if (videos.length === 0) {
        const { extractEpisodeMedia } = await import('./extract.js');
        const generic = await extractEpisodeMedia(page, allMediaRequests);
        if (generic.videos.length > 0) {
          videos = generic.videos;
        }
      }

      // Estrategia Blogger: se ainda sem video mas capturamos um token
      // blogger.com/video.g?token=, abrimos essa pagina do player do Blogger
      // num frame proprio e clicamos no play do YouTube -> gera googlevideo
      // videoplayback (IP-vinculado ao backend). E o fluxo documentado pelo user.
      if (videos.length === 0) {
        const bloggerToken = allMediaRequests.find((u) =>
          /blogger\.com\/video\.g\?token=/i.test(u),
        );
        if (bloggerToken) {
          console.log(
            '[SCRAPE] abrindo token Blogger:',
            bloggerToken.slice(0, 80) + '...',
          );
          const bv = await this.extractBloggerVideo(
            context,
            bloggerToken,
            episodeUrl,
          );
          if (bv.length > 0) videos = bv;
        }
      }

      // Diagnostico final.

      console.log(
        '[SCRAPE] resultado final videos=',
        videos.length,
        videos.slice(0, 2),
      );

      // Wrap das URLs externas via proxy de midia; descarta iframes (anuncios
      // + embed de sites de terceiros que nao interessam ao player proprio).
      return {
        videos: videos.map((v) => wrapMediaUrl(v, episodeUrl)),
        iframes: [],
        cloudflare: false,
      };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      this.activeScrapes -= 1;
    }
  }

  /** Resolve o adapter: explícito por id, senão auto-detecta pelo host. */
  private resolveSource(url: string, sourceId?: string): ScrapeSource {
    if (sourceId) {
      const found = this.sources.find((s) => s.id === sourceId);
      if (found) return found;
      // sourceId desconhecido: cai p/ auto-detect (nao falha).
    }
    const auto = this.sources.find((s) => s.supports(url));
    if (auto) return auto;

    // URL de fonte nao mapeada: usa o adapter genérico default (animefire-like),
    // que extrai <video>/<source>/iframes — funciona p/ varios players.
    // sources é populado estaticamente no constructor (sempre >= 3 itens).
    return this.sources[0]!;
  }

  /**
   * Encontra um adapter que (1) suporta a URL e (2) implementa `extractHttp`.
   * Exposto p/ outros serviços (StreamingService) re-extraírem vídeo sem
   * subir o Playwright. Retorna null se nenhum adapter HTTP puro servir.
   */
  findHttpSource(url: string): ScrapeSource | null {
    const s = this.sources.find(
      (src) => typeof src.extractHttp === 'function' && src.supports(url),
    );
    return s ?? null;
  }

  /**
   * Re-extração lazy: quando o stream de um episódio recebe 403 da CDN
   * (token .mp4 expirado), refaz a extração HTTP pura da fonte e persiste o
   * NOVO videoUrl RAW em Episode.videoUrl. Retorna a URL RAW atualizada, ou
   * null se não houver fonte HTTP/re-extração falhar.
   *
   * Pressupõe `episode.embedUrl` guarda a URL da página do episódio na fonte
   * (ex: https://animefire.io/animes/<slug>/<ep>). Hoje só animefire tem
   * extração HTTP pura; outras fontes retornam null (sem re-extração).
   */
  async reextractEpisodeVideo(
    animeSlug: string,
    episodeNumber: number,
  ): Promise<string | null> {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });
    if (!anime) return null;

    const episode = await this.prisma.episode.findUnique({
      where: { animeId_number: { animeId: anime.id, number: episodeNumber } },
      select: { id: true, embedUrl: true },
    });
    if (!episode || !episode.embedUrl) return null;

    const source = this.sources.find(
      (s) =>
        typeof s.extractHttp === 'function' && s.supports(episode.embedUrl!),
    );
    if (!source || !source.extractHttp) return null;

    let rawMp4: string | null = null;
    try {
      const result = await source.extractHttp({
        episodeUrl: episode.embedUrl,
        ua: UA_DESKTOP,
      });
      rawMp4 = result.videos[0] ?? null;
    } catch (err) {
      console.log(
        `[REEXTRACT] falhou p/ ${animeSlug}/${episodeNumber}:`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
    if (!rawMp4) return null;

    await this.prisma.episode.update({
      where: { id: episode.id },
      data: { videoUrl: rawMp4 },
    });

    console.log(
      `[REEXTRACT] atualizado ${animeSlug}/${episodeNumber} ->`,
      rawMp4.slice(0, 80) + '...',
    );
    return rawMp4;
  }

  /**
   * Estrategia Blogger: abre a pagina do player do Blogger
   * (blogger.com/video.g?token=...) num frame proprio do mesmo contexto do
   * browser (mesmo IP p/ satisfazer o IP-vinculo do token), clica no botao de
   * play do YouTube/Blogger e intercepta a request googlevideo.com/videoplayback
   * (.mp4 real). E o fluxo que o player faz quando o user clica em play.
   */
  private async extractBloggerVideo(
    context: BrowserContext,
    bloggerTokenUrl: string,
    _episodeUrl: string,
  ): Promise<string[]> {
    const captured: string[] = [];
    const bvPage = await context.newPage();
    bvPage.on('request', (req) => {
      const u = req.url();
      if (/videoplayback|googlevideo|\.mp4($|\?|#)/i.test(u)) {
        captured.push(u);
      }
    });

    try {
      await bvPage.goto(bloggerTokenUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      // Aguarda o player do YouTube/Blogger carregar.
      await bvPage.waitForTimeout(4000);

      // Tenta clicar no botao de play do player do YouTube (dentro de iframe).
      const playSelectors = [
        '.ytp-cued-thumbnail-overlay',
        '.ytp-large-play-button',
        '[aria-label*="Play" i]',
        'button[aria-label*="Play" i]',
      ];
      let clicked = false;
      for (const sel of playSelectors) {
        try {
          const el = await bvPage.$(sel);
          if (el) {
            await el.click({ timeout: 3000 }).catch(() => undefined);
            clicked = true;
            break;
          }
        } catch {
          /* tentative */
        }
      }
      // Se nao achou no page principal, procura nos iframes do Blogger.
      if (!clicked) {
        for (const frame of bvPage.mainFrame().childFrames()) {
          for (const sel of playSelectors) {
            try {
              const el = await frame.$(sel);
              if (el) {
                await el.click({ timeout: 3000 }).catch(() => undefined);
                clicked = true;
                break;
              }
            } catch {
              /* cross-origin */
            }
          }
          if (clicked) break;
        }
      }

      console.log(
        '[BLOGGER] clicked=',
        clicked,
        'capturado-ate-agora=',
        captured.length,
      );

      // Aguarda as requests de videoplayback apos o clique.
      const start = Date.now();
      while (Date.now() - start < 12000) {
        if (bvPage.isClosed()) break;
        await bvPage.waitForTimeout(300).catch(() => undefined);
        if (captured.length > 0) break;
      }

      console.log(
        '[BLOGGER] capturado-final=',
        captured.length,
        captured.slice(0, 2),
      );
      return [...new Set(captured)];
    } catch (err) {
      console.log(
        '[BLOGGER] erro:',
        err instanceof Error ? err.message : String(err),
      );
      return [];
    } finally {
      await bvPage.close().catch(() => undefined);
    }
  }

  /** Detecta tela de desafio Cloudflare pelo <title>. */
  private async detectCloudflare(page: Page): Promise<boolean> {
    const title = (await page.title().catch(() => '')).toLowerCase();
    return CLOUDFLARE_MARKERS.some((m) => title.includes(m));
  }

  /** Aguarda player/iframe/video anexado ao DOM. */
  private async waitPlayer(page: Page): Promise<void> {
    try {
      await page.waitForSelector(PLAYER_SELECTORS, {
        timeout: 25000,
        state: 'attached',
      });
    } catch {
      try {
        await page.waitForSelector(PLAYER_SELECTORS, {
          timeout: 5000,
          state: 'visible',
        });
      } catch {
        // ignora: extraimos mesmo assim o que existir
      }
    }
  }
}
