// src/embed/scrape/scrape.service.ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright';
import type { Page, BrowserContext, Browser } from 'playwright';
import { ScrapeSource, ScrapeEpisodeResult } from './scrape-source.interface';
import { AnimefireScrapeSource } from './animefire.source';
import { AnimesonlineccScrapeSource } from './animesonlinecc.source';
import { MeusanimesScrapeSource } from './meusanimes.source';
import { youtubeEmbedUrl } from './extract';
import { PrismaService } from '@/prisma/prisma.service';
import { ensureXvfb } from './xvfb.helper';
/** Remove quebras de linha/separadores Unicode de dados externos antes de logar. */
function sanitizeLog(v: string): string {
  return v.replace(/[\r\n\u2028\u2029]/g, ' ');
}

/** Debug logger (survives NestJS log suppression). */
function dbg(msg: string): void {
  console.error(`${new Date().toISOString()} ${sanitizeLog(msg)}`);
}

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
 * valida Referer contra animefire.io; googlevideo valida contra youtube.googleapis.com).
 */
function originOf(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/**
 * Resolve o Referer correto para a URL de mídia com base no host da CDN.
 * - googlevideo.com (vindo de Blogger/YouTube): exige Referer youtube.googleapis.com
 * - lightspeedst.net (vindo de animefire): exige Referer animefire.io
 * - default: origem da própria URL
 */
function refererForMediaUrl(mediaUrl: string, episodeUrl: string): string {
  try {
    const u = new URL(mediaUrl);
    const host = u.hostname.toLowerCase();

    // googlevideo (tokens Blogger resolvidos via Playwright)
    if (/googlevideo\.com$/i.test(host)) {
      return 'https://youtube.googleapis.com/';
    }

    // lightspeedst (animefire CDN)
    if (/lightspeedst\.net$/i.test(host)) {
      return 'https://animefire.io/';
    }

    // fallback: origem do episódio
    return originOf(episodeUrl);
  } catch {
    return originOf(episodeUrl);
  }
}

function wrapMediaUrl(raw: string, episodeUrl: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  const ref = refererForMediaUrl(trimmed, episodeUrl);
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
   * @param wrap se true (default), URLs externas sao embrulhadas no proxy de
   *             midia interno (/api/embed/media?url=...). Use false p/ obter
   *             RAW (re-extração de streaming precisa do RAW).
   */
  async scrapeEpisodeVideo(
    episodeUrl: string,
    sourceId?: string,
    wrap = false,
  ): Promise<ScrapeEpisodeResult> {
    dbg(
      `[SCRAPE] scrapeEpisodeVideo url=${episodeUrl} sourceId=${sourceId ?? 'auto'} wrap=${wrap}`,
    );
    const source = this.resolveSource(episodeUrl, sourceId);
    dbg(
      `[SCRAPE] resolved source=${source.id} supports=${source.supports(episodeUrl)}`,
    );

    // Limita a concorrência de chromium headless (memória/CPU do host).
    if (this.activeScrapes >= this.MAX_CONCURRENT_SCRAPES) {
      throw new ServiceUnavailableException(
        'Muitas extrações simultâneas. Tente novamente em instantes.',
      );
    }
    this.activeScrapes += 1;

    // Caminho HTTP puro: se o adapter implementa extractHttp, pula o Playwright.
    // Relevante p/ animefire (extraível por fetch, sem Cloudflare/browser em prod)
    // e meusanimes (get-video.php). Se o adapter devolver playerTokens (player
    // Blogger/YouTube), ainda precisa do chromium p/ virar .mp4 googlevideo.
    if (typeof source.extractHttp === 'function') {
      try {
        dbg(`[SCRAPE] calling extractHttp on ${source.id}...`);
        const raw = await source.extractHttp({ episodeUrl, ua: UA_DESKTOP });
        dbg(
          `[SCRAPE] extractHttp OK: videos=${raw.videos.length} playerTokens=${(raw.playerTokens ?? []).length}`,
        );

        let videos = raw.videos;
        const playerTokens = raw.playerTokens ?? [];
        // Embeds do YouTube não são resolvíveis p/ .mp4 server-side (YouTube
        // bloqueia IPs datacenter com LOGIN_REQUIRED). Ficam no retorno p/ o
        // streaming servir como iframe no browser do usuário.
        const resolvableTokens = playerTokens.filter(
          (t) => !youtubeEmbedUrl(t),
        );
        const youtubeEmbeds = playerTokens.filter((t) => youtubeEmbedUrl(t));
        if (videos.length === 0 && resolvableTokens.length > 0) {
          dbg(
            `[SCRAPE] ${resolvableTokens.length} player tokens, resolving via chromium...`,
          );
          // Blogger token resolve via googlevideo videoplayback interceptado
          // pelo chromium. headless:true funciona no chrome moderno (validado).
          // Fallback: Xvfb + headless:false se headless falhar.
          let browser: Browser | null = null;
          let resolved = false;

          // Tentativa 1: headless:true (preferido — funciona em containers sem X).
          try {
            browser = await chromium.launch({
              headless: true,
              chromiumSandbox: false,
              args: [],
            });
            const context = await browser.newContext({
              userAgent: UA_DESKTOP,
              locale: 'pt-BR',
              viewport: { width: 1366, height: 768 },
            });
            for (const token of resolvableTokens) {
              const bv = await this.extractPlayerVideo(
                context,
                token,
                episodeUrl,
              );
              if (bv.length > 0) {
                videos = bv;
                resolved = true;
                break;
              }
            }
            await context.close().catch(() => undefined);
          } catch (err) {
            dbg(
              `[SCRAPE] headless:true falhou p/ Blogger: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            if (browser) await browser.close().catch(() => undefined);
            browser = null;
          }

          // Tentativa 2: Xvfb + headless:false (fallback se headless falhou).
          if (!resolved) {
            const display = await ensureXvfb();
            if (display) {
              dbg(
                `[SCRAPE] tentando Xvfb (${display}) + headless:false para Blogger...`,
              );
              try {
                browser = await chromium.launch({
                  headless: false,
                  chromiumSandbox: false,
                  args: ['--no-sandbox', '--disable-gpu'],
                });
                await new Promise((r) => setTimeout(r, 1000));
                const context = await browser.newContext({
                  userAgent: UA_DESKTOP,
                  locale: 'pt-BR',
                  viewport: { width: 1366, height: 768 },
                });
                for (const token of resolvableTokens) {
                  const bv = await this.extractPlayerVideo(
                    context,
                    token,
                    episodeUrl,
                  );
                  if (bv.length > 0) {
                    videos = bv;
                    break;
                  }
                }
                await context.close().catch(() => undefined);
              } catch (err) {
                dbg(
                  `[SCRAPE] headless:false (Xvfb) também falhou: ${err instanceof Error ? err.message : String(err)}`,
                );
              } finally {
                if (browser) await browser.close().catch(() => undefined);
              }
            } else {
              dbg(
                `[SCRAPE] Xvfb indisponível e headless:true não resolveu Blogger.`,
              );
            }
          }
        }

        dbg(
          `[SCRAPE] extractHttp returning: videos=${videos.length} wrap=${wrap}`,
        );
        return {
          videos: wrap
            ? videos.map((v) => wrapMediaUrl(v, episodeUrl))
            : videos,
          iframes: [],
          cloudflare: false,
          // Expõe tokens de player não resolvíveis por HTTP (YouTube embeds
          // bloqueados p/ IP datacenter, etc.) p/ o chamador decidir fallback.
          playerTokens: youtubeEmbeds,
        };
      } finally {
        this.activeScrapes -= 1;
      }
    }

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        chromiumSandbox: false,
      });
      context = await browser.newContext({
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

      await page.goto(episodeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      // Diagnostico: titulo da pagina (detecta paywall/redirect/erro).

      console.error(
        '[SCRAPE] goto OK url=',
        sanitizeLog(episodeUrl),
        'title=',
        sanitizeLog(await page.title().catch(() => '?')),
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

      console.error(
        '[SCRAPE] pre-extract media requests:',
        allMediaRequests.length,
        sanitizeLog(JSON.stringify(allMediaRequests.slice(0, 5))),
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

      console.error(
        '[SCRAPE] iframes:',
        sanitizeLog(JSON.stringify(diagIframes)),
      );

      console.error(
        '[SCRAPE] botoes-play-candidatos:',
        sanitizeLog(JSON.stringify(diagButtons)),
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

      // Estrategia de player: se ainda sem video mas capturamos um token
      // blogger.com/video.g?token= (ou YouTube), abrimos essa pagina do player
      // num frame proprio e clicamos no play -> gera googlevideo videoplayback
      // (IP-vinculado ao backend). E o fluxo documentado pelo user.
      if (videos.length === 0) {
        const playerToken = allMediaRequests.find((u) =>
          /blogger\.com\/video\.g\?token=/i.test(u),
        );
        if (playerToken) {
          console.error(
            '[SCRAPE] abrindo token de player:',
            sanitizeLog(playerToken.slice(0, 80) + '...'),
          );
          const bv = await this.extractPlayerVideo(
            context,
            playerToken,
            episodeUrl,
          );
          if (bv.length > 0) videos = bv;
        }
      }

      // Diagnostico final.

      console.error(
        '[SCRAPE] resultado final videos=',
        videos.length,
        sanitizeLog(JSON.stringify(videos.slice(0, 2))),
      );

      // Wrap das URLs externas via proxy de midia; descarta iframes (anuncios
      // + embed de sites de terceiros que nao interessam ao player proprio).
      return {
        videos: videos.map((v) => wrapMediaUrl(v, episodeUrl)),
        iframes: [],
        cloudflare: false,
      };
    } finally {
      // Garante liberação mesmo se newContext/newPage falharem (sem leak de
      // processo chromium nem de contador de concorrência).
      if (context) await context.close().catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
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
   * (ex: https://animefire.io/animes/<slug>/<ep>).
   */
  async reextractEpisodeVideo(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
  ): Promise<string | null> {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });
    if (!anime) return null;

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: anime.id,
          season,
          number: episodeNumber,
        },
      },
      select: { id: true, embedUrl: true },
    });
    if (!episode || !episode.embedUrl) return null;

    const source = this.sources.find(
      (s) =>
        typeof s.extractHttp === 'function' && s.supports(episode.embedUrl!),
    );
    if (!source || !source.extractHttp) return null;

    let rawMp4: string | null;
    try {
      const result = await source.extractHttp({
        episodeUrl: episode.embedUrl,
        ua: UA_DESKTOP,
      });
      rawMp4 = result.videos[0] ?? null;
    } catch (err) {
      console.error(
        `[REEXTRACT] falhou p/ ${sanitizeLog(animeSlug)}/${episodeNumber}:`,
        sanitizeLog(err instanceof Error ? err.message : String(err)),
      );
      return null;
    }
    if (!rawMp4) return null;

    await this.prisma.episode.update({
      where: { id: episode.id },
      data: { videoUrl: rawMp4 },
    });

    console.error(
      `[REEXTRACT] atualizado ${sanitizeLog(animeSlug)}/${episodeNumber} ->`,
      sanitizeLog(rawMp4.slice(0, 80) + '...'),
    );
    return rawMp4;
  }

  /**
   * Constrói a URL de um episódio no meusanimes.blog a partir do slug do anime,
   * número do episódio e temporada.
   * Padrão: meusanimes.blog/e/<slug>-episodio-<n>/
   *
   * Post-split: o slug já codifica a temporada (ex: "kaguya-sama-love-is-war-2").
   * O parâmetro season é mantido para compatibilidade mas NÃO é injetado no slug.
   */
  meusanimesEpisodeUrl(
    animeSlug: string,
    episodeNumber: number,
    _seasonNumber: number = 1,
  ): string {
    return `https://meusanimes.blog/e/${animeSlug}-episodio-${episodeNumber}/`;
  }

  /**
   * Tenta extrair vídeo de um episódio via meusanimes.blog (fallback quando
   * animefire.io bloqueia o IP da VPS com Cloudflare WAF 403).
   *
   * Fluxo: GET meusanimes.blog/e/<slug>-episodio-<n>/ -> iframe servN.meusdoramas.club
   * -> get-video.php -> token Blogger -> Playwright headless:false + Xvfb ->
   * googlevideo.com/videoplayback (.mp4).
   *
   * Filmes/singles não usam o sufixo `-episodio-<n>` — a URL é
   * meusanimes.blog/e/<slug>/ — então tenta candidatos em ordem até achar o
   * que não retorne 404.
   *
   * Retorna a URL .mp4 RAW (sem wrap) ou null se falhar.
   */
  async scrapeFromMeusanimes(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
  ): Promise<string | null> {
    const candidates = [
      this.meusanimesEpisodeUrl(animeSlug, episodeNumber, season),
      `https://meusanimes.blog/e/${animeSlug}/`,
      `https://meusanimes.blog/e/${animeSlug}-episodio-${episodeNumber}/`,
    ];

    for (const episodeUrl of candidates) {
      dbg(`[MEUSANIMES] try ${animeSlug}/${episodeNumber} -> ${episodeUrl}`);
      try {
        const result = await this.scrapeEpisodeVideo(
          episodeUrl,
          undefined,
          false,
        );
        const video = result.videos[0] ?? null;
        if (video) {
          dbg(
            `[MEUSANIMES] OK ${animeSlug}/${episodeNumber}: ${video.slice(0, 80)}...`,
          );
          return video;
        }
        dbg(`[MEUSANIMES] no video returned ${animeSlug}/${episodeNumber}`);
      } catch (err) {
        dbg(
          `[MEUSANIMES] candidate failed ${episodeUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return null;
  }

  /**
   * Estrategia de player: abre a pagina do player (Blogger video.g?token=...,
   * YouTube watch/embed) num frame proprio do mesmo contexto do browser
   * (mesmo IP p/ satisfazer o IP-vinculo do token), clica no botao de play e
   * intercepta a request googlevideo.com/videoplayback (.mp4 real). E o fluxo
   * que o player faz quando o user clica em play.
   *
   * Descarta requests auxiliares (generate_204) — so devolve videoplayback/.mp4.
   */
  private async extractPlayerVideo(
    context: BrowserContext,
    playerTokenUrl: string,
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
      await bvPage.goto(playerTokenUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      // Aguarda o player do Blogger/YouTube carregar e fazer batchexecute.
      await bvPage.waitForTimeout(8000);

      // O player do Blogger não tem <video> no DOM; o clique no body
      // dispara o play do YouTube embed que gera a request googlevideo.
      await bvPage.click('body', { timeout: 3000 }).catch(() => undefined);

      // Tenta clicar em botões de play do YouTube (caso existam no iframe).
      const playSelectors = [
        '.ytp-cued-thumbnail-overlay',
        '.ytp-large-play-button',
        '[aria-label*="Play" i]',
        'button[aria-label*="Play" i]',
      ];
      for (const sel of playSelectors) {
        try {
          const el = await bvPage.$(sel);
          if (el) {
            await el.click({ timeout: 3000 }).catch(() => undefined);
            break;
          }
        } catch {
          /* tentative */
        }
      }
      // Procura nos iframes do player.
      for (const frame of bvPage.mainFrame().childFrames()) {
        for (const sel of playSelectors) {
          try {
            const el = await frame.$(sel);
            if (el) {
              await el.click({ timeout: 3000 }).catch(() => undefined);
              break;
            }
          } catch {
            /* cross-origin */
          }
        }
      }

      // Aguarda as requests de videoplayback após o clique.
      const start = Date.now();
      while (Date.now() - start < 15000) {
        if (bvPage.isClosed()) break;
        await bvPage.waitForTimeout(300).catch(() => undefined);
        if (captured.length > 0) break;
      }

      // So URLs de stream de verdade (.mp4/videoplayback); generate_204 do
      // YouTube é keep-alive, não vira <video src>.
      const playable = [...new Set(captured)].filter((u) =>
        /videoplayback|\.mp4($|\?|#)/i.test(u),
      );
      console.error(
        '[PLAYER] capturado=',
        captured.length,
        'playable=',
        playable.length,
        sanitizeLog(
          JSON.stringify(playable.slice(0, 2).map((u) => u.slice(0, 80))),
        ),
      );
      return playable;
    } catch (err) {
      console.error(
        '[PLAYER] erro:',
        sanitizeLog(err instanceof Error ? err.message : String(err)),
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
