// src/embed/scrape/scrape.service.ts
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { chromium } from 'playwright';
import type { Page, BrowserContext, Browser } from 'playwright';
import { ScrapeSource, ScrapeEpisodeResult } from './scrape-source.interface';
import { AnimefireScrapeSource } from './animefire.source';
import { AnimesonlineccScrapeSource } from './animesonlinecc.source';
import { MeusanimesScrapeSource } from './meusanimes.source';
import { youtubeEmbedUrl } from './extract';
import {
  waitForPlayerReady,
  extractPlayerVideoEventDriven,
} from './event-waits';
import { BrowserPool } from './browser-pool.service';
import { PrismaService } from '@/prisma/prisma.service';
import { HealthMonitor } from '@/watchtower/health-monitor.service';
import { MetricsService } from '@/metrics/metrics.service';
import { SOURCE_IDS } from '@/watchtower/watchtower.types';
import { ensureXvfb } from './xvfb.helper';
import { refererForMediaUrlWithFallback } from '@/common/url-utils';
/** Remove quebras de linha/separadores Unicode de dados externos antes de logar. */
function sanitizeLog(v: string): string {
  return v.replace(/[\r\n\u2028\u2029]/g, ' ');
}

/** Debug logger (survives NestJS log suppression). */
function dbg(msg: string): void {
  console.error(`${new Date().toISOString()} ${sanitizeLog(msg)}`);
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
function wrapMediaUrl(raw: string, episodeUrl: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  const ref = refererForMediaUrlWithFallback(trimmed, episodeUrl);
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

/** Entrada do cache SWR de resultados de extração (sempre RAW, sem wrap). */
interface ScrapeCacheEntry {
  result: ScrapeEpisodeResult;
  fetchedAt: number;
  expiresAt: number;
}

/**
 * ScrapeService — orquestrador de providers (Provider Orchestration Layer).
 *
 * Responsável por:
 *  - Escolher dinamicamente o melhor provider: consulta o HealthMonitor
 *    (watchtower) p/ pular fontes disabled e priorizar as mais saudáveis
 *    (score = taxaSucesso × 1/(1+latência)).
 *  - Registrar success/failure + latência de cada extração no HealthMonitor
 *    (fonte única de verdade p/ o ranking — o Extractor do watchtower não
 *    registra mais).
 *  - Cachear resultados RAW por (sourceId, episodeUrl) com stale-while-revalidate:
 *    TTL fresco serve direto; na janela stale serve imediatamente e revalida em
 *    background (com single-flight por chave p/ não derrubar o scraper de
 *    chromium em thundering herd); se a revalidação falhar, degrada servindo o
 *    stale (o fluxo de 403 do streaming re-extrai depois).
 *
 * Extração técnica de URL .mp4/.m3u8 + iframes de episódio, multi-fonte via
 * Playwright (chromium headless) e caminho HTTP puro (extractHttp) quando a
 * fonte permite (animefire, meusanimes).
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
  private readonly MAX_CONCURRENT_SCRAPES: number;
  private readonly SCRAPE_QUEUE_TIMEOUT_MS: number;
  private readonly scrapeWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  /** Cache SWR em memória (single-instance). Chave: `scrape:<sourceId>:<url>`. */
  private readonly cache = new Map<string, ScrapeCacheEntry>();
  /** Single-flight por chave: evita N chromium concorrentes p/ a mesma URL. */
  private readonly inflight = new Map<string, Promise<ScrapeEpisodeResult>>();
  private readonly CACHE_TTL_MS: number;
  private readonly CACHE_STALE_MS: number;
  private readonly CACHE_MAX_ENTRIES = 200;

  constructor(
    animefire: AnimefireScrapeSource,
    animesonlinecc: AnimesonlineccScrapeSource,
    meusanimes: MeusanimesScrapeSource,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => HealthMonitor))
    private readonly health: HealthMonitor,
    private readonly metrics: MetricsService,
    private readonly browserPool: BrowserPool,
  ) {
    this.sources = [animefire, animesonlinecc, meusanimes];
    const ttl = Number(process.env.SCRAPE_CACHE_TTL_MS ?? 10 * 60_000);
    const stale = Number(process.env.SCRAPE_CACHE_STALE_MS ?? 60 * 60_000);
    this.CACHE_TTL_MS = Number.isFinite(ttl) && ttl > 0 ? ttl : 10 * 60_000;
    this.CACHE_STALE_MS =
      Number.isFinite(stale) && stale > 0 ? stale : 60 * 60_000;
    const concurrency = Number(process.env.MAX_CONCURRENT_SCRAPES ?? 2);
    this.MAX_CONCURRENT_SCRAPES =
      Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 2;
    const queueTimeout = Number(process.env.SCRAPE_QUEUE_TIMEOUT_MS ?? 30_000);
    this.SCRAPE_QUEUE_TIMEOUT_MS =
      Number.isFinite(queueTimeout) && queueTimeout > 0 ? queueTimeout : 30_000;
  }

  /** Remove entradas depois da janela SWR, mesmo quando não são acessadas. */
  @Cron(CronExpression.EVERY_MINUTE)
  cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.fetchedAt + this.CACHE_STALE_MS <= now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Abre a página de um episodio no chromium headless e extrai URLs de video.
   * Orquestra: resolve provider (health-aware) -> cache SWR -> extração com
   * single-flight -> wrap no proxy de mídia.
   *
   * @param episodeUrl URL absoluta do episodio.
   * @param sourceId opcional força um adapter (animefire/animesonlinecc/meusanimes);
   *                 sem source, escolhe dinamicamente o provider mais saudável
   *                 que suporta a URL (pula disabled do HealthMonitor).
   * @param wrap se true (default), URLs externas sao embrulhadas no proxy de
   *             midia interno (/api/embed/media?url=...). Use false p/ obter
   *             RAW (re-extração de streaming precisa do RAW).
   */
  async scrapeEpisodeVideo(
    episodeUrl: string,
    sourceId?: string,
    wrap = false,
    forceRefresh = false,
  ): Promise<ScrapeEpisodeResult> {
    const source = await this.resolveSource(episodeUrl, sourceId);
    const cacheKey = this.cacheKey(source.id, episodeUrl);
    const now = Date.now();
    const entry = this.cache.get(cacheKey);

    // Hit fresco: serve direto (sem consumir slot de chromium, sem health).
    if (!forceRefresh && entry && now < entry.expiresAt) {
      dbg(
        `[SCRAPE] cache HIT (fresco) source=${source.id} url=${sanitizeLog(episodeUrl.slice(0, 80))}`,
      );
      this.metrics.recordCacheHit('fresh');
      return this.wrapResult(entry.result, episodeUrl, wrap);
    }

    // Janela stale-while-revalidate: serve stale imediatamente e revalida em
    // background (single-flight compartilhado — nunca 2 fetches p/ a mesma URL).
    if (!forceRefresh && entry && now < entry.fetchedAt + this.CACHE_STALE_MS) {
      dbg(
        `[SCRAPE] cache STALE (servindo + revalidando) source=${source.id} url=${sanitizeLog(episodeUrl.slice(0, 80))}`,
      );
      this.metrics.recordCacheHit('stale');
      void this.startOrJoinFetch(cacheKey, episodeUrl, source).catch((err) =>
        dbg(
          `[SCRAPE] revalidação em background falhou: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return this.wrapResult(entry.result, episodeUrl, wrap);
    }

    // Miss (ou stale além da janela): extração real com single-flight por chave.
    dbg(
      `[SCRAPE] ${forceRefresh ? 'refresh FORCADO' : 'cache MISS'} source=${source.id} url=${sanitizeLog(episodeUrl.slice(0, 80))}`,
    );
    this.metrics.recordCacheMiss();
    try {
      const result = await this.startOrJoinFetch(cacheKey, episodeUrl, source);
      return this.wrapResult(result, episodeUrl, wrap);
    } catch (err) {
      // Provider falhou mas temos resultado stale: degrada servindo o stale
      // (URLs podem ter expirado — o fluxo de 403 do streaming re-extrai).
      if (entry && !forceRefresh) {
        dbg(
          `[SCRAPE] fetch falhou — servindo stale em degradação (${err instanceof Error ? err.message : String(err)})`,
        );
        // failure = tentativa de fetch; degraded = resultado do serve (o
        // fetchAndCache já registrou recordExtractionFailure no catch).
        this.metrics.recordDegradedServe();
        return this.wrapResult(entry.result, episodeUrl, wrap);
      }
      throw err;
    }
  }

  /**
   * Single-flight por chave: retorna o fetch em andamento p/ (cacheKey) ou
   * inicia um novo. Chamado tanto pelo caminho de miss quanto pela revalidação
   * em background — garante no máximo 1 extração simultânea por URL.
   */
  private startOrJoinFetch(
    cacheKey: string,
    episodeUrl: string,
    source: ScrapeSource,
  ): Promise<ScrapeEpisodeResult> {
    let inflight = this.inflight.get(cacheKey);
    if (!inflight) {
      inflight = this.fetchAndCache(episodeUrl, source, cacheKey).finally(
        () => {
          if (this.inflight.get(cacheKey) === inflight) {
            this.inflight.delete(cacheKey);
          }
        },
      );
      this.inflight.set(cacheKey, inflight);
    }
    return inflight;
  }

  /**
   * Extração real (RAW) + registro de health + atualização do cache.
   * Controla o slot de concorrência do chromium (único lugar que o consome).
   */
  private async fetchAndCache(
    episodeUrl: string,
    source: ScrapeSource,
    cacheKey: string,
  ): Promise<ScrapeEpisodeResult> {
    await this.acquireScrapeSlot();
    const t0 = Date.now();
    try {
      dbg(
        `[SCRAPE] extraindo source=${source.id} url=${sanitizeLog(episodeUrl.slice(0, 120))}`,
      );
      const result = await this.fetchRawVideos(episodeUrl, source);
      // Só cacheia resultados úteis (vídeo OU player token). Resultado vazio
      // vira failure p/ demover o provider (página mudou/foi bloqueada).
      const ok =
        result.videos.length > 0 || (result.playerTokens?.length ?? 0) > 0;
      if (ok) {
        await this.recordSuccess(source.id, Date.now() - t0);
        this.metrics.recordExtraction(source.id, Date.now() - t0);
        this.cache.set(cacheKey, {
          result,
          fetchedAt: Date.now(),
          expiresAt: Date.now() + this.CACHE_TTL_MS,
        });
        this.evictIfNeeded();
      } else {
        await this.recordFailure(source.id);
        this.metrics.recordExtractionFailure(source.id);
      }
      return result;
    } catch (err) {
      await this.recordFailure(source.id);
      this.metrics.recordExtractionFailure(source.id);
      throw err;
    } finally {
      this.releaseScrapeSlot();
    }
  }

  /**
   * Fila FIFO curta para absorver rajadas. Rejeitar imediatamente quando os
   * dois Chromiums estão ocupados fazia fontes de fallback falharem em cascata.
   * O limite continua baixo para proteger CPU/RAM; ele é configurável sem
   * rebuild, mas aumentar concorrência deve ser uma decisão operacional.
   */
  private async acquireScrapeSlot(): Promise<void> {
    if (this.activeScrapes < this.MAX_CONCURRENT_SCRAPES) {
      this.activeScrapes += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.scrapeWaiters.indexOf(waiter);
          if (index >= 0) this.scrapeWaiters.splice(index, 1);
          reject(
            new ServiceUnavailableException(
              'Fila de extração ocupada. Tente novamente em instantes.',
            ),
          );
        }, this.SCRAPE_QUEUE_TIMEOUT_MS),
      };
      this.scrapeWaiters.push(waiter);
    });
  }

  private releaseScrapeSlot(): void {
    const waiter = this.scrapeWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      // O slot é transferido diretamente; activeScrapes permanece constante.
      waiter.resolve();
      return;
    }
    this.activeScrapes = Math.max(0, this.activeScrapes - 1);
  }

  /**
   * Extração RAW em si (sem wrap, sem cache, sem health): caminho HTTP puro
   * (extractHttp) com fallback Playwright p/ player tokens, ou caminho
   * Playwright completo. Extraído de scrapeEpisodeVideo p/ permitir cache SWR.
   *
   * Utiliza BrowserPool para reutilizar a instância Chromium (elimina cold
   * start de ~1-3s) e event-based waits para substituir sleeps hardcoded
   * (reduz 15-30s de waits para 3-10s).
   */
  private async fetchRawVideos(
    episodeUrl: string,
    source: ScrapeSource,
  ): Promise<ScrapeEpisodeResult> {
    // Caminho HTTP puro: se o adapter implementa extractHttp, pula o Playwright.
    if (typeof source.extractHttp === 'function') {
      dbg(`[SCRAPE] calling extractHttp on ${source.id}...`);
      const raw = await source.extractHttp({ episodeUrl, ua: UA_DESKTOP });
      dbg(
        `[SCRAPE] extractHttp OK: videos=${raw.videos.length} playerTokens=${(raw.playerTokens ?? []).length}`,
      );

      let videos = raw.videos;
      const playerTokens = raw.playerTokens ?? [];
      const resolvableTokens = playerTokens.filter((t) => !youtubeEmbedUrl(t));
      const youtubeEmbeds = playerTokens.filter((t) => youtubeEmbedUrl(t));
      if (videos.length === 0 && resolvableTokens.length > 0) {
        dbg(
          `[SCRAPE] ${resolvableTokens.length} player tokens, resolving via chromium pool...`,
        );

        // Utiliza BrowserPool para reutilizar instância Chromium
        let resolved = false;
        for (const token of resolvableTokens) {
          const { context, release } = await this.browserPool.acquireContext(
            `player-${source.id}`,
          );
          try {
            const bv = await extractPlayerVideoEventDriven(
              await context.newPage(),
              token,
            );
            if (bv.length > 0) {
              videos = bv;
              resolved = true;
              break;
            }
          } catch (err) {
            dbg(
              `[SCRAPE] pool resolve falhou: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            await release();
          }
        }

        // Fallback: Xvfb + headless:false se o pool não resolveu
        if (!resolved) {
          const display = await ensureXvfb();
          if (display) {
            dbg(
              `[SCRAPE] tentando Xvfb (${display}) + headless:false para Blogger...`,
            );
            let browser: Browser | null = null;
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
                const bv = await extractPlayerVideoEventDriven(
                  await context.newPage(),
                  token,
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
          }
        }
      }

      dbg(`[SCRAPE] extractHttp returning: videos=${videos.length} (RAW)`);
      return {
        videos,
        iframes: [],
        cloudflare: false,
        playerTokens: videos.length === 0 ? playerTokens : youtubeEmbeds,
      };
    }

    // Caminho Playwright completo: utiliza BrowserPool
    const { context, release } = await this.browserPool.acquireContext(
      `scrape-${source.id}`,
    );
    try {
      const page = await context.newPage();

      // Listener de requests ANTES do goto
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

      console.error(
        '[SCRAPE] goto OK url=',
        sanitizeLog(episodeUrl),
        'title=',
        sanitizeLog(await page.title().catch(() => '?')),
      );

      // Cloudflare: detecta tela de desafio e aborta
      if (await this.detectCloudflare(page)) {
        throw new ServiceUnavailableException(
          'Cloudflare bloqueou a página do episódio (não contornamos bot-detection).',
        );
      }

      // Aguarda player pronto via detecção por events (substitui waitForTimeout(6000))
      const { ready, mediaUrls: eventMedia } = await waitForPlayerReady(
        page,
        allMediaRequests,
      );
      allMediaRequests.push(...eventMedia);

      console.error(
        '[SCRAPE] player ready=',
        ready,
        'media requests:',
        allMediaRequests.length,
        sanitizeLog(JSON.stringify(allMediaRequests.slice(0, 5))),
      );

      const result = await source.extract(page);

      let videos = result.videos;
      if (videos.length === 0) {
        const { extractEpisodeMedia } = await import('./extract.js');
        const generic = await extractEpisodeMedia(page, allMediaRequests);
        if (generic.videos.length > 0) {
          videos = generic.videos;
        }
      }

      // Estratégia de player: se ainda sem video mas capturamos um token blogger
      if (videos.length === 0) {
        const playerToken = allMediaRequests.find((u) =>
          /blogger\.com\/video\.g\?token=/i.test(u),
        );
        if (playerToken) {
          console.error(
            '[SCRAPE] abrindo token de player:',
            sanitizeLog(playerToken.slice(0, 80) + '...'),
          );
          // Utiliza event-driven extraction (reduz 8s+15s para ~3s+4s)
          const tokenPage = await context.newPage();
          const bv = await extractPlayerVideoEventDriven(
            tokenPage,
            playerToken,
          );
          if (bv.length > 0) videos = bv;
        }
      }

      console.error(
        '[SCRAPE] resultado final videos=',
        videos.length,
        sanitizeLog(JSON.stringify(videos.slice(0, 2))),
      );

      return {
        videos,
        iframes: [],
        cloudflare: false,
      };
    } finally {
      await release();
    }
  }

  /**
   * Resolve o adapter: explícito por id (honra sempre), senão auto-detecta
   * pelo host usando a ordem de saúde do HealthMonitor (disabled ficam de fora
   * do rankedSources; fontes fora de SOURCE_IDS entram no fim). Se nenhuma
   * fonte suporta a URL, usa o adapter genérico default (animefire-like).
   */
  private async resolveSource(
    url: string,
    sourceId?: string,
  ): Promise<ScrapeSource> {
    if (sourceId) {
      const found = this.sources.find((s) => s.id === sourceId);
      if (found) return found;
      // sourceId desconhecido: cai p/ auto-detect (nao falha).
    }
    const ordered = await this.healthOrderedSources();
    const hit = ordered.find((s) => s.supports(url));
    if (hit) return hit;
    return this.sources[0]!;
  }

  /**
   * Primeira fonte HTTP pura que suporta a URL, na ordem de saúde (ranked).
   * Usado por reextractEpisodeVideo p/ preferir providers saudáveis.
   */
  private async firstHttpSource(url: string): Promise<ScrapeSource | null> {
    const ordered = await this.healthOrderedSources();
    return (
      ordered.find(
        (s) => typeof s.extractHttp === 'function' && s.supports(url),
      ) ?? null
    );
  }

  /** Fontes ordenadas por saúde (rankedSources) com fontes não-rastreadas no fim. */
  private async healthOrderedSources(): Promise<ScrapeSource[]> {
    let order: string[] = [];
    try {
      order = await this.health.rankedSources();
    } catch (err) {
      dbg(
        `[SCRAPE] rankedSources falhou, usando ordem base: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return [
      ...order
        .map((id) => this.sources.find((s) => s.id === id))
        .filter((s): s is ScrapeSource => Boolean(s)),
      ...this.sources.filter((s) => !order.includes(s.id)),
    ];
  }

  /**
   * Re-extração lazy: quando o stream de um episódio recebe 403 da CDN
   * (token .mp4 expirado), refaz a extração HTTP pura da fonte mais saudável
   * e persiste o NOVO videoUrl RAW em Episode.videoUrl. Em sucesso, invalida
   * o cache de scrape do episódio e o semeia com o resultado fresco.
   * Retorna a URL RAW atualizada, ou null se não houver fonte HTTP/extração falhar.
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

    const source = await this.firstHttpSource(episode.embedUrl);
    if (!source || !source.extractHttp) return null;

    const t0 = Date.now();
    let rawMp4: string | null;
    try {
      const result = await source.extractHttp({
        episodeUrl: episode.embedUrl,
        ua: UA_DESKTOP,
      });
      rawMp4 = result.videos[0] ?? null;
    } catch (err) {
      await this.recordFailure(source.id);
      this.metrics.recordReextract(source.id, false);
      console.error(
        `[REEXTRACT] falhou p/ ${sanitizeLog(animeSlug)}/${episodeNumber}:`,
        sanitizeLog(err instanceof Error ? err.message : String(err)),
      );
      return null;
    }
    if (!rawMp4) {
      await this.recordFailure(source.id);
      this.metrics.recordReextract(source.id, false);
      return null;
    }

    await this.prisma.episode.update({
      where: { id: episode.id },
      data: { videoUrl: rawMp4 },
    });

    await this.recordSuccess(source.id, Date.now() - t0);
    this.metrics.recordReextract(source.id, true, Date.now() - t0);
    this.invalidateEpisode(episode.embedUrl);
    this.seedCache(source.id, episode.embedUrl, rawMp4);

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
   * Estrategia de player (legado, usado como fallback): abre a pagina do player
   * num frame proprio do mesmo contexto do browser (mesmo IP p/ satisfazer o
   * IP-vinculo), clica no botao de play e intercepta a request
   * googlevideo.com/videoplayback (.mp4 real).
   *
   * Utiliza waits reduzidos (3s + 4s vs 8s + 15s original) via detecção por events.
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
      // Espera reduzida: 3s (vs 8s) para player carregar
      await bvPage.waitForTimeout(3000);

      await bvPage.click('body', { timeout: 3000 }).catch(() => undefined);

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

      // Espera reduzida: 4s (vs 15s) para requests de videoplayback
      const start = Date.now();
      while (Date.now() - start < 4000) {
        if (bvPage.isClosed()) break;
        await bvPage.waitForTimeout(300).catch(() => undefined);
        if (captured.length > 0) break;
      }

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

  /** Aplica o wrap do proxy de mídia sobre um resultado RAW (cache ou fetch). */
  private wrapResult(
    result: ScrapeEpisodeResult,
    episodeUrl: string,
    wrap: boolean,
  ): ScrapeEpisodeResult {
    return {
      videos: wrap
        ? result.videos.map((v) => wrapMediaUrl(v, episodeUrl))
        : result.videos,
      iframes: [],
      cloudflare: result.cloudflare ?? false,
      playerTokens: result.playerTokens,
    };
  }

  private cacheKey(sourceId: string, episodeUrl: string): string {
    return `scrape:${sourceId}:${episodeUrl}`;
  }

  /** Invalida entradas de cache de um episódio (após re-extração bem-sucedida). */
  invalidateEpisode(episodeUrl: string): void {
    const suffix = `:${episodeUrl}`;
    for (const key of this.cache.keys()) {
      if (key.endsWith(suffix)) this.cache.delete(key);
    }
  }

  /** Semeia o cache com um resultado recém re-extraído (evita re-scrape). */
  private seedCache(
    sourceId: string,
    episodeUrl: string,
    rawMp4: string,
  ): void {
    const now = Date.now();
    this.cache.set(this.cacheKey(sourceId, episodeUrl), {
      result: { videos: [rawMp4], iframes: [], cloudflare: false },
      fetchedAt: now,
      expiresAt: now + this.CACHE_TTL_MS,
    });
    this.evictIfNeeded();
  }

  /** Evita crescimento sem teto do cache (evicta o entry mais antigo). */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.CACHE_MAX_ENTRIES) return;
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of this.cache) {
      if (v.fetchedAt < oldestAt) {
        oldestAt = v.fetchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }

  /** Registra success no HealthMonitor (só p/ fontes rastreadas em SOURCE_IDS). */
  private async recordSuccess(
    sourceId: string,
    latencyMs: number,
  ): Promise<void> {
    if (!(SOURCE_IDS as readonly string[]).includes(sourceId)) return;
    await this.health.recordSuccess(sourceId, latencyMs).catch(() => undefined);
  }

  /** Registra failure no HealthMonitor (só p/ fontes rastreadas em SOURCE_IDS). */
  private async recordFailure(sourceId: string): Promise<void> {
    if (!(SOURCE_IDS as readonly string[]).includes(sourceId)) return;
    await this.health.recordFailure(sourceId).catch(() => undefined);
  }
}
