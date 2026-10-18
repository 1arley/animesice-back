import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { EmbedService } from '@/embed/embed.service';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { isNoVideoUrl, youtubeEmbedUrl } from '@/embed/scrape/extract';
import {
  probeMediaUrlDead,
  purgeExpiredLivenessCache,
  signedExpiryDead,
  shouldReextractMedia,
} from '@/common/media-probe';
import { refererForMediaUrl } from '@/common/url-utils';
import { trustMediaHosts } from '@/common/trusted-media-hosts';
import { Readable } from 'stream';
import type { AudioType } from '@prisma/client';

function dbg(msg: string): void {
  const safeMsg = msg.replace(/[\r\n\u2028\u2029]/g, ' ');
  console.error(`${new Date().toISOString()} ${safeMsg}`);
}

/**
 * Helper que envolve uma URL externa (.mp4/.m3u8) no proxy de mídia interno
 * `/embed/media?url=...&referer=<sourceOrigin>` — assim o client (browser)
 * consome pelo mesmo host do backend, injetando Referer/Origin/UA anti-hotlinking
 * e usando o IP de saída do backend (mesmo IP que extraiu o token da CDN).
 */
function wrapMediaUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  const referer = refererForMediaUrl(trimmed);
  return `/embed/media?url=${encodeURIComponent(trimmed)}&referer=${encodeURIComponent(referer)}`;
}

export type ExtractionJobStatus =
  'pending' | 'processing' | 'completed' | 'failed';

export interface ExtractionJob {
  id: string;
  animeSlug: string;
  episodeNumber: number;
  season: number;
  status: ExtractionJobStatus;
  result: { videoUrl: string | null; playerEmbed: string | null } | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  lockedUntil?: number | null;
}

type JobListener = (job: ExtractionJob) => void;

const JOB_TTL_MS = 5 * 60_000;

interface ScrapeOutcome {
  videoUrl: string | null;
  playerEmbed: string | null;
  sourceId?: string;
  pageUrl?: string;
  audio?: AudioType;
}

/**
 * Estrutura do source do stream público. `src` aponta para o `/embed/media`
 * (mesmo host do backend, anti-hotlinking resolvido server-side); o player
 * só usa esse `src` direto — sem token, sem IP-vinculo no client.
 */
export interface StreamSourceResponse {
  animeSlug: string;
  episodeNumber: number;
  /** URL final para o <video src> do player (proxy de mídia do backend). */
  src: string;
  /** origem CRU do vídeo (.mp4 da CDN) — p/ diagnóstico apenas. */
  rawVideoUrl: string | null;
  /** URL da página da fonte de onde o vídeo foi extraído. */
  embedUrl: string | null;
  /** se houve re-extração nesta chamada (útil p/ auditoria). */
  reextracted: boolean;
  /** poster opcional do episódio. */
  thumbnailUrl: string | null;
}

@Injectable()
export class StreamingService implements OnModuleDestroy {
  private readonly logger = new Logger(StreamingService.name);

  /** Single-flight + cache curto p/ re-extrações (anti thundering herd no
   *  scraper de chromium, que é caro e concorrencia-limitado). */
  private readonly scrapeInflight = new Map<
    string,
    Promise<{ videoUrl: string | null; playerEmbed: string | null }>
  >();
  private readonly scrapeCache = new Map<
    string,
    {
      result: { videoUrl: string | null; playerEmbed: string | null };
      at: number;
    }
  >();
  private readonly SCRAPE_CACHE_TTL_MS = 5 * 60_000;

  /** Teto de entradas nos caches de inflight — evita crescimento ilimitado
   *  sob carga sustentada (OOM). Entradas mais antigas são descartadas. */
  private static readonly MAX_INFLIGHT_ENTRIES = 200;

  /** Teto de entradas no scrapeCache — evita crescimento indefinido de memória.
   *  Entradas mais antigas (por `at`) são evictadas quando o teto é atingido. */
  private static readonly MAX_SCRAPE_CACHE_ENTRIES = 300;

  private readonly jobListeners = new Map<string, Set<JobListener>>();
  private jobPollTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedService: EmbedService,
    private readonly scrapeService: ScrapeService,
  ) {}

  onModuleDestroy(): void {
    clearTimeout(this.jobPollTimer);
    this.jobPollTimer = undefined;
    this.jobListeners.clear();
  }

  private scheduleJobPoll(): void {
    if (this.jobPollTimer || !this.jobListeners.size) return;
    this.jobPollTimer = setTimeout(() => {
      void (async () => {
        try {
          for (const id of this.jobListeners.keys()) {
            const job = await this.getJob(id);
            if (job) this.notifyJobListeners(job);
          }
        } catch {
          return;
        } finally {
          this.jobPollTimer = undefined;
          this.scheduleJobPoll();
        }
      })();
    }, 1_000);
    this.jobPollTimer.unref();
  }

  private notifyJobListeners(job: ExtractionJob): void {
    if (job.status !== 'completed' && job.status !== 'failed') return;
    const listeners = this.jobListeners.get(job.id);
    this.jobListeners.delete(job.id);
    if (!this.jobListeners.size) {
      clearTimeout(this.jobPollTimer);
      this.jobPollTimer = undefined;
    }
    for (const listener of listeners ?? []) {
      try {
        listener(job);
      } catch {
        continue;
      }
    }
  }

  /**
   * Registra um callback de conclusão de job para uso no SSE endpoint.
   * Retorna uma função de cleanup que remove o listener.
   */
  async onJobComplete(
    jobId: string,
    listener: (job: ExtractionJob) => void,
  ): Promise<() => void> {
    const listeners = this.jobListeners.get(jobId) ?? new Set<JobListener>();
    listeners.add(listener);
    this.jobListeners.set(jobId, listeners);
    const unsubscribe = () => {
      listeners.delete(listener);
      if (!listeners.size && this.jobListeners.get(jobId) === listeners) {
        this.jobListeners.delete(jobId);
      }
      if (!this.jobListeners.size) {
        clearTimeout(this.jobPollTimer);
        this.jobPollTimer = undefined;
      }
    };
    try {
      const job = await this.getJob(jobId);
      if (job) this.notifyJobListeners(job);
      this.scheduleJobPoll();
      return unsubscribe;
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  /**
   * Constrói StreamSourceResponse a partir de um job — público para SSE.
   */
  buildSourceResponseFromJob(
    job: ExtractionJob,
    apiOriginBackend: string,
  ): Promise<StreamSourceResponse> {
    return this.buildSourceFromJobResult(job, apiOriginBackend);
  }

  /** Purga tokens de streaming expirados (a cada 6h) p/ evitar crescimento. */
  @Cron('0 */6 * * *')
  async purgeExpiredTokens(): Promise<void> {
    const r = await this.prisma.streamingToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (r.count > 0) {
      console.log(`[STREAM] purge: ${r.count} tokens expirados removidos`);
    }
  }

  /** Expiração física dos caches em memória e jobs antigos. */
  @Cron(CronExpression.EVERY_MINUTE)
  cleanupMemoryCaches(): void {
    const now = Date.now();
    for (const [key, entry] of this.scrapeCache) {
      if (entry.at + this.SCRAPE_CACHE_TTL_MS <= now) {
        this.scrapeCache.delete(key);
      }
    }
    this.evictScrapeCacheIfNeeded();
    if (this.scrapeInflight.size > StreamingService.MAX_INFLIGHT_ENTRIES) {
      const keys = [...this.scrapeInflight.keys()];
      for (const k of keys.slice(
        0,
        keys.length - StreamingService.MAX_INFLIGHT_ENTRIES,
      )) {
        this.scrapeInflight.delete(k);
      }
    }
    purgeExpiredLivenessCache(now);
    void this.prisma.streamExtractionJob
      ?.deleteMany?.({
        where: { completedAt: { lt: new Date(now - JOB_TTL_MS) } },
      })
      .catch(() => undefined);
  }

  /** Evicta a entrada mais antiga quando o cache excede o teto máximo. */
  private evictScrapeCacheIfNeeded(): void {
    if (this.scrapeCache.size <= StreamingService.MAX_SCRAPE_CACHE_ENTRIES)
      return;
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of this.scrapeCache) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) this.scrapeCache.delete(oldestKey);
  }

  /**
   * Desembrulha URLs legadas `/embed/media?url=...` e filtra URLs vazias/no-video.
   */
  private unwrapStoredVideoUrl(raw: string | null): string | null {
    let url = raw;
    if (url && isNoVideoUrl(url)) url = null;
    if (url && /\/embed\/media\?url=/i.test(url)) {
      try {
        const parsed = new URL(url);
        const inner = parsed.searchParams.get('url');
        if (inner) url = inner;
      } catch {
        /* mantém */
      }
    }
    return url;
  }

  /**
   * Formata o StreamSourceResponse único para fluxos síncronos, assíncronos e SSE.
   */
  private formatStreamSourceResponse(params: {
    animeSlug: string;
    episodeNumber: number;
    episodeEmbedUrl: string | null;
    thumbnailUrl: string | null;
    rawVideoUrl: string | null;
    playerEmbed: string | null;
    reextracted: boolean;
    apiOriginBackend: string;
  }): StreamSourceResponse {
    const {
      animeSlug,
      episodeNumber,
      episodeEmbedUrl,
      thumbnailUrl,
      rawVideoUrl,
      playerEmbed,
      reextracted,
      apiOriginBackend,
    } = params;
    const base = apiOriginBackend.replace(/\/$/, '');
    const apiPrefix = process.env.API_PREFIX || 'api';

    if (playerEmbed && !rawVideoUrl) {
      const isYoutube = youtubeEmbedUrl(playerEmbed) !== null;
      const embedSrc = isYoutube
        ? playerEmbed
        : `${base}/${apiPrefix}/embed/proxy?url=${encodeURIComponent(playerEmbed)}`;
      dbg(`[STREAM] fonte é player embed — servindo iframe: ${embedSrc}`);
      return {
        animeSlug,
        episodeNumber,
        src: embedSrc,
        rawVideoUrl: playerEmbed,
        embedUrl: embedSrc,
        reextracted,
        thumbnailUrl,
      };
    }

    const src = `${base}/${apiPrefix}${wrapMediaUrl(rawVideoUrl!)}`;
    return {
      animeSlug,
      episodeNumber,
      src,
      rawVideoUrl,
      embedUrl: episodeEmbedUrl,
      reextracted,
      thumbnailUrl,
    };
  }

  /**
   * Verifica se o anime pode ser resolvido pelo player:
   * publicado (`published: true`) ou auto-despublicado pelo catálogo (`catalogUnpublished: true`).
   * Títulos despublicados manualmente (`published: false, catalogUnpublished: false`) lançam 404.
   */
  private isAnimeResolvable(anime: {
    published?: boolean;
    catalogUnpublished?: boolean;
  }): boolean {
    if (anime.published === undefined || anime.published === true) return true;
    return anime.catalogUnpublished === true;
  }

  async generateToken(
    episodeSlug: string,
    animeSlug: string,
    clientIp: string,
    ttlSeconds: number = 86400,
  ) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug, published: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episodeNumber = /^\d+$/.test(episodeSlug)
      ? parseInt(episodeSlug, 10)
      : NaN;

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: anime.id,
          season: 1,
          number: episodeNumber,
        },
      },
    });

    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    if (!episode.videoUrl) {
      throw new NotFoundException('Vídeo não disponível para este episódio.');
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.streamingToken.create({
      data: {
        token,
        ip: clientIp,
        expiresAt,
        episodeId: episode.id,
      },
    });

    const expiresUnix = Math.floor(expiresAt.getTime() / 1000);

    const tokenUrl = new URL(episode.videoUrl);
    tokenUrl.searchParams.set('token', token);
    tokenUrl.searchParams.set('expires', String(expiresUnix));
    tokenUrl.searchParams.set('ip', clientIp);

    return {
      url: tokenUrl.toString(),
      token,
      expires: expiresUnix,
      ip: clientIp,
      episode,
    };
  }

  /**
   * Executa a extração sob single-flight e persiste o resultado no banco.
   */
  private runCoalescedScrape(
    episode: { id: string; embedUrl: string | null },
    animeSlug: string,
    episodeNumber: number,
    season: number,
    audio?: AudioType,
    forceRefresh = false,
  ): Promise<{ videoUrl: string | null; playerEmbed: string | null }> {
    const key = `${animeSlug}:${season}:${episodeNumber}:${audio ?? 'auto'}`;
    if (forceRefresh) {
      this.scrapeCache.delete(key);
    }
    let inflight = this.scrapeInflight.get(key);
    if (!inflight) {
      inflight = this.doSingleScrape(
        episode,
        animeSlug,
        episodeNumber,
        season,
        true,
        audio,
      )
        .then((outcome) => {
          const result = {
            videoUrl: outcome.videoUrl,
            playerEmbed: outcome.playerEmbed,
          };
          this.scrapeCache.set(key, { result, at: Date.now() });
          return result;
        })
        .finally(() => {
          this.scrapeInflight.delete(key);
        });
      this.scrapeInflight.set(key, inflight);
    }
    return inflight;
  }

  /**
   * Resolve o videoUrl de um episódio com single-flight + cache TTL na parte
   * cara (scrape via chromium). Fluxo: unwrap legado -> probe de liveness ->
   * re-extração (embrulhada no single-flight).
   */
  private async resolveVideo(
    episode: {
      id: string;
      videoUrl: string | null;
      embedUrl: string | null;
    },
    animeSlug: string,
    episodeNumber: number,
    season: number,
    forceRefresh = false,
    skipLiveness = false,
    audio?: AudioType,
    isCatalogUnpublished = false,
  ): Promise<{
    videoUrl: string | null;
    playerEmbed: string | null;
    reextracted: boolean;
  }> {
    let rawVideoUrl = this.unwrapStoredVideoUrl(episode.videoUrl);

    dbg(
      `[STREAM] getSource animeSlug=${animeSlug} ep=${episodeNumber} embedUrl=${episode.embedUrl ?? 'null'} videoUrl=${episode.videoUrl?.slice(0, 80) ?? 'null'}`,
    );

    const lastKnownVideoUrl = rawVideoUrl;
    let lastKnownDead = false;

    if (forceRefresh && rawVideoUrl && /^https?:\/\//i.test(rawVideoUrl)) {
      const dead = await probeMediaUrlDead(rawVideoUrl, true);
      dbg(
        `[STREAM] probe forçado videoUrl=${rawVideoUrl.slice(0, 80)} dead=${dead}`,
      );
      if (!dead) {
        if (isCatalogUnpublished) {
          await this.persistPlayerResolvedEpisode(
            episode.id,
            rawVideoUrl,
            undefined,
            undefined,
            audio,
          );
        }
        return {
          videoUrl: rawVideoUrl,
          playerEmbed: null,
          reextracted: false,
        };
      }
      lastKnownDead = true;
      rawVideoUrl = null;
    }

    const mustProbeStored = !skipLiveness || isCatalogUnpublished;
    if (
      !forceRefresh &&
      mustProbeStored &&
      rawVideoUrl &&
      /^https?:\/\//i.test(rawVideoUrl)
    ) {
      const dead = await probeMediaUrlDead(rawVideoUrl, isCatalogUnpublished);
      dbg(`[STREAM] probe videoUrl=${rawVideoUrl.slice(0, 80)} dead=${dead}`);
      if (dead) {
        lastKnownDead = true;
        dbg(
          `[STREAM] videoUrl morta — re-extraindo antes de responder p/ ${animeSlug}/${episodeNumber}`,
        );
        rawVideoUrl = null;
      } else if (isCatalogUnpublished) {
        await this.persistPlayerResolvedEpisode(
          episode.id,
          rawVideoUrl,
          undefined,
          undefined,
          audio,
        );
      }
    }

    if (!forceRefresh && rawVideoUrl && /^https?:\/\//i.test(rawVideoUrl)) {
      return { videoUrl: rawVideoUrl, playerEmbed: null, reextracted: false };
    }

    // Sem videoUrl utilizável -> re-extração (single-flight + cache curto).
    const key = `${animeSlug}:${season}:${episodeNumber}:${audio ?? 'auto'}`;
    if (forceRefresh) {
      this.scrapeCache.delete(key);
    }
    const cached = this.scrapeCache.get(key);
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.at < this.SCRAPE_CACHE_TTL_MS &&
      (!cached.result.videoUrl ||
        !(await probeMediaUrlDead(cached.result.videoUrl)))
    ) {
      dbg(`[STREAM] scrape cache hit p/ ${key}`);
      if (isCatalogUnpublished && cached.result.videoUrl) {
        await this.persistPlayerResolvedEpisode(
          episode.id,
          cached.result.videoUrl,
          undefined,
          undefined,
          audio,
        );
      }
      return { ...cached.result, reextracted: false };
    }
    if (cached) this.scrapeCache.delete(key);

    const result = await this.runCoalescedScrape(
      episode,
      animeSlug,
      episodeNumber,
      season,
      audio,
      false,
    );
    if (
      !result.videoUrl &&
      !result.playerEmbed &&
      lastKnownVideoUrl &&
      !lastKnownDead &&
      !isCatalogUnpublished
    ) {
      return {
        videoUrl: lastKnownVideoUrl,
        playerEmbed: null,
        reextracted: false,
      };
    }
    return { ...result, reextracted: true };
  }

  /** Scrape real usando URLs persistidas por fonte + fallback ranqueado por saúde. */
  private async doSingleScrape(
    episode: { id: string; embedUrl: string | null },
    animeSlug: string,
    episodeNumber: number,
    season: number,
    persist = true,
    audio?: AudioType,
  ): Promise<ScrapeOutcome> {
    let rawVideoUrl: string | null = null;
    let playerEmbed: string | null = null;
    let winningSourceId: string | undefined;
    let winningPageUrl: string | undefined;

    const mappedSources =
      (await this.prisma.episodeSource?.findMany({
        where: { episodeId: episode.id },
        select: { sourceId: true, pageUrl: true },
        orderBy: { verifiedAt: 'desc' },
      })) ?? [];
    const sourceUrls = [
      ...(episode.embedUrl
        ? [{ sourceId: undefined, pageUrl: episode.embedUrl }]
        : []),
      ...mappedSources,
    ].filter(
      (candidate, index, all) =>
        all.findIndex((item) => item.pageUrl === candidate.pageUrl) === index,
    );

    for (const source of sourceUrls) {
      if (
        await this.scrapeService.isSourceDisabled(
          source.sourceId,
          source.pageUrl,
        )
      ) {
        continue;
      }
      dbg(
        `[STREAM] tentando URL persistida source=${source.sourceId ?? 'legacy'} url=${source.pageUrl.slice(0, 80)}`,
      );
      try {
        const result = await this.scrapeService.scrapeEpisodeVideo(
          source.pageUrl,
          source.sourceId,
          false,
          true,
          audio,
        );
        for (const video of result.videos) {
          if (!(await probeMediaUrlDead(video, true))) {
            rawVideoUrl = video;
            winningSourceId =
              source.sourceId ??
              this.scrapeService.detectSourceId?.(source.pageUrl) ??
              undefined;
            winningPageUrl = source.pageUrl;
            break;
          }
        }
        playerEmbed ??=
          (result.playerTokens ?? []).find(
            (t) =>
              youtubeEmbedUrl(t) !== null ||
              /blogger\.com\/video\.g\?token=/i.test(t),
          ) ?? null;
        dbg(
          `[STREAM] fonte persistida resultado: videos=${result.videos.length} rawVideoUrl=${rawVideoUrl?.slice(0, 80) ?? 'null'} playerEmbed=${playerEmbed?.slice(0, 60) ?? 'null'}`,
        );
        if (rawVideoUrl) break;
      } catch (err) {
        dbg(
          `[STREAM] fonte persistida FALHOU: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (
      !rawVideoUrl &&
      typeof this.scrapeService.scrapeEpisodeFromRankedSources === 'function'
    ) {
      try {
        const fallback =
          await this.scrapeService.scrapeEpisodeFromRankedSources(
            animeSlug,
            episodeNumber,
            season,
            audio,
            async (url) => !(await probeMediaUrlDead(url, true)),
          );
        if (fallback?.videoUrl) {
          rawVideoUrl = fallback.videoUrl;
          winningSourceId = fallback.sourceId;
          winningPageUrl = fallback.pageUrl;
        }
      } catch (err) {
        dbg(
          `[STREAM] fallback ranqueado falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (rawVideoUrl && persist) {
      await this.persistPlayerResolvedEpisode(
        episode.id,
        rawVideoUrl,
        winningSourceId,
        winningPageUrl,
        audio,
      );
    }

    return {
      videoUrl: rawVideoUrl,
      playerEmbed,
      sourceId: winningSourceId,
      pageUrl: winningPageUrl,
      audio,
    };
  }

  private async persistPlayerResolvedEpisode(
    episodeId: string,
    rawVideoUrl: string,
    sourceId?: string,
    pageUrl?: string,
    audio?: AudioType,
    db: {
      episode?: PrismaService['episode'];
      episodeSource?: PrismaService['episodeSource'];
      anime?: PrismaService['anime'];
    } = this.prisma,
  ): Promise<void> {
    trustMediaHosts([rawVideoUrl]);
    await db.episode
      ?.update({
        where: { id: episodeId },
        data: { videoUrl: rawVideoUrl },
      })
      .catch(() => undefined);

    if (sourceId && pageUrl && db.episodeSource) {
      await db.episodeSource
        .upsert({
          where: {
            episodeId_sourceId: {
              episodeId,
              sourceId,
            },
          },
          update: {
            pageUrl,
            ...(audio ? { audio } : {}),
            verifiedAt: new Date(),
            lastError: null,
          },
          create: {
            episodeId,
            sourceId,
            pageUrl,
            audio: audio ?? 'LEGENDADO',
            verifiedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }

    await db.anime
      ?.updateMany?.({
        where: {
          episodes: { some: { id: episodeId } },
          published: false,
        },
        data: {
          published: true,
          catalogUnpublished: false,
          catalogAbsentChecks: 0,
          catalogAbsenceCheckedAt: null,
        },
      })
      .catch(() => undefined);
  }

  /**
   * Origem do stream público (sem JWT). Resolve o videoUrl de um episódio.
   *
   * Se `videoUrl` já existe válido, retorna imediatamente (cache hit).
   * Se precisa de re-extração, retorna o resultado síncrono.
   *
   * Para extração assíncrona, usar `getSourceAsync()` que retorna 202 com jobId.
   */
  async getSource(
    animeSlug: string,
    episodeNumber: number,
    apiOriginBackend: string,
    season: number = 1,
    forceRefresh = false,
    skipLiveness = false,
  ): Promise<StreamSourceResponse> {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: {
        id: true,
        slug: true,
        audio: true,
        published: true,
        catalogUnpublished: true,
      },
    });
    if (!anime || !this.isAnimeResolvable(anime)) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: anime.id,
          season,
          number: episodeNumber,
        },
      },
      select: {
        id: true,
        number: true,
        videoUrl: true,
        embedUrl: true,
        thumbnailUrl: true,
      },
    });
    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    const isCatalogUnpublished =
      anime.published === false && anime.catalogUnpublished === true;

    const {
      videoUrl: rawVideoUrl,
      playerEmbed,
      reextracted,
    } = await this.resolveVideo(
      episode,
      anime.slug,
      episodeNumber,
      season,
      forceRefresh,
      skipLiveness,
      anime.audio,
      isCatalogUnpublished,
    );

    if (!rawVideoUrl && !playerEmbed) {
      throw new NotFoundException(
        'Vídeo não disponível: re-extração falhou em todas as fontes.',
      );
    }

    if (isCatalogUnpublished && !rawVideoUrl) {
      throw new NotFoundException(
        'Vídeo não disponível: re-extração falhou em todas as fontes.',
      );
    }

    return this.formatStreamSourceResponse({
      animeSlug: anime.slug,
      episodeNumber: episode.number,
      episodeEmbedUrl: episode.embedUrl,
      thumbnailUrl: episode.thumbnailUrl,
      rawVideoUrl,
      playerEmbed,
      reextracted,
      apiOriginBackend,
    });
  }

  /**
   * Versão assíncrona de getSource: quando o videoUrl não existe e extração é
   * necessária, dispara a extração em background e retorna um jobId.
   *
   * O cliente deve pollar `getJobStatus(jobId)` até completion.
   * Retorna null quando o videoUrl já existe (resposta síncrona direta).
   */
  async getSourceAsync(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
    forceRefresh = false,
  ): Promise<{ jobId: string } | null> {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: {
        id: true,
        slug: true,
        audio: true,
        published: true,
        catalogUnpublished: true,
      },
    });
    if (!anime || !this.isAnimeResolvable(anime)) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: anime.id,
          season,
          number: episodeNumber,
        },
      },
      select: {
        id: true,
        number: true,
        videoUrl: true,
        embedUrl: true,
        thumbnailUrl: true,
      },
    });
    if (!episode) throw new NotFoundException('Episódio não encontrado.');

    const isCatalogUnpublished =
      anime.published === false && anime.catalogUnpublished === true;

    const rawVideoUrl = this.unwrapStoredVideoUrl(episode.videoUrl);

    if (
      !forceRefresh &&
      !isCatalogUnpublished &&
      rawVideoUrl &&
      /^https?:\/\//i.test(rawVideoUrl) &&
      signedExpiryDead(rawVideoUrl) !== true
    ) {
      return null;
    }

    const job = await this.submitExtractionJob(
      animeSlug,
      episodeNumber,
      season,
      { id: episode.id, embedUrl: episode.embedUrl },
      anime.audio,
    );

    dbg(
      `[STREAM] async extraction started: job=${job.id} anime=${animeSlug} ep=${episodeNumber}`,
    );
    return { jobId: job.id };
  }

  async getJob(id: string): Promise<ExtractionJob | undefined> {
    const job = await this.prisma.streamExtractionJob.findUnique({
      where: { id },
    });
    return job ? this.toExtractionJob(job) : undefined;
  }

  private async findActiveJobByEpisode(
    animeSlug: string,
    episodeNumber: number,
    season: number,
  ): Promise<ExtractionJob | undefined> {
    const job = await this.prisma.streamExtractionJob.findFirst({
      where: {
        animeSlug,
        episodeNumber,
        season,
        status: { in: ['pending', 'processing'] },
      },
    });
    return job ? this.toExtractionJob(job) : undefined;
  }

  private async submitExtractionJob(
    animeSlug: string,
    episodeNumber: number,
    season: number,
    episode?: { id: string; embedUrl: string | null },
    audio?: AudioType,
  ): Promise<ExtractionJob> {
    const activeKey = `${animeSlug}:s${season}:ep${episodeNumber}`;
    let job = await this.findActiveJobByEpisode(
      animeSlug,
      episodeNumber,
      season,
    );
    if (!job) {
      try {
        job = this.toExtractionJob(
          await this.prisma.streamExtractionJob.create({
            data: { activeKey, animeSlug, episodeNumber, season },
          }),
        );
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        job = await this.findActiveJobByEpisode(
          animeSlug,
          episodeNumber,
          season,
        );
        if (!job) throw error;
      }
    }
    void this.startExtractionJob(job, episode, audio).catch(
      (error: unknown) => {
        this.logger.error(
          `Falha ao iniciar job de extração ${job.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      },
    );
    return job;
  }

  private resumeExtractionJobIfStale(job: ExtractionJob): void {
    if (
      job.status !== 'pending' &&
      !(
        job.status === 'processing' &&
        job.lockedUntil != null &&
        job.lockedUntil <= Date.now()
      )
    ) {
      return;
    }
    void this.startExtractionJob(job).catch((error: unknown) => {
      this.logger.error(
        `Falha ao retomar job de extração ${job.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private async startExtractionJob(
    job: ExtractionJob,
    preloadedEpisode?: { id: string; embedUrl: string | null },
    preloadedAudio?: AudioType,
  ): Promise<void> {
    const lockId = crypto.randomUUID();
    const claim = await this.prisma.streamExtractionJob.updateMany({
      where: {
        id: job.id,
        OR: [
          { status: 'pending' },
          { status: 'processing', lockedUntil: { lt: new Date() } },
        ],
      },
      data: {
        status: 'processing',
        lockedBy: lockId,
        lockedUntil: new Date(Date.now() + JOB_TTL_MS),
      },
    });
    if (!claim.count) return;

    try {
      let episode = preloadedEpisode ?? null;
      let audio = preloadedAudio;
      if (!episode) {
        const anime = await this.prisma.anime.findUnique({
          where: { slug: job.animeSlug },
          select: { id: true, audio: true },
        });
        audio = anime?.audio;
        episode = anime
          ? await this.prisma.episode.findUnique({
              where: {
                animeId_season_number: {
                  animeId: anime.id,
                  season: job.season,
                  number: job.episodeNumber,
                },
              },
              select: { id: true, embedUrl: true },
            })
          : null;
      }

      if (!episode) {
        await this.finishExtractionJob(
          job.id,
          lockId,
          'failed',
          null,
          null,
          'Episódio não encontrado.',
        );
        return;
      }

      const outcome = await this.doSingleScrape(
        episode,
        job.animeSlug,
        job.episodeNumber,
        job.season,
        false,
        audio,
      );
      await this.finishExtractionJob(
        job.id,
        lockId,
        'completed',
        episode.id,
        outcome,
        null,
      );
    } catch (error) {
      await this.finishExtractionJob(
        job.id,
        lockId,
        'failed',
        null,
        null,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async finishExtractionJob(
    id: string,
    lockId: string,
    status: 'completed' | 'failed',
    episodeId: string | null,
    outcome: ScrapeOutcome | null,
    error: string | null,
  ): Promise<void> {
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.streamExtractionJob.updateMany({
        where: { id, status: 'processing', lockedBy: lockId },
        data: {
          activeKey: null,
          status,
          videoUrl: outcome?.videoUrl ?? null,
          playerEmbed: outcome?.playerEmbed ?? null,
          error,
          lockedBy: null,
          lockedUntil: null,
          completedAt: new Date(),
        },
      });
      if (!updated.count) return null;

      const finished = await tx.streamExtractionJob.findUnique({
        where: { id },
      });
      if (!finished) return null;

      if (status === 'completed' && outcome?.videoUrl) {
        let targetEpisodeId = episodeId;
        if (!targetEpisodeId) {
          const anime = await tx.anime.findUnique({
            where: { slug: finished.animeSlug },
            select: { id: true },
          });
          const ep = anime
            ? await tx.episode.findUnique({
                where: {
                  animeId_season_number: {
                    animeId: anime.id,
                    season: finished.season,
                    number: finished.episodeNumber,
                  },
                },
                select: { id: true },
              })
            : null;
          targetEpisodeId = ep?.id ?? null;
        }
        if (targetEpisodeId) {
          await this.persistPlayerResolvedEpisode(
            targetEpisodeId,
            outcome.videoUrl,
            outcome.sourceId,
            outcome.pageUrl,
            outcome.audio,
            tx,
          );
        } else {
          trustMediaHosts([outcome.videoUrl]);
        }
      }

      return finished;
    });
    if (row) this.notifyJobListeners(this.toExtractionJob(row));
  }

  private toExtractionJob(job: {
    id: string;
    animeSlug: string;
    episodeNumber: number;
    season: number;
    status: string;
    videoUrl: string | null;
    playerEmbed: string | null;
    error: string | null;
    createdAt: Date;
    completedAt: Date | null;
    lockedUntil: Date | null;
  }): ExtractionJob {
    return {
      id: job.id,
      animeSlug: job.animeSlug,
      episodeNumber: job.episodeNumber,
      season: job.season,
      status: job.status as ExtractionJobStatus,
      result:
        job.videoUrl || job.playerEmbed
          ? { videoUrl: job.videoUrl, playerEmbed: job.playerEmbed }
          : null,
      error: job.error,
      createdAt: job.createdAt.getTime(),
      completedAt: job.completedAt?.getTime() ?? null,
      lockedUntil: job.lockedUntil?.getTime() ?? null,
    };
  }

  /**
   * Consulta status de um job de extração assíncrona.
   * Quando o job completa, retorna o StreamSourceResponse pronto —
   * eliminando a necessidade de uma segunda chamada getSource() no client.
   */
  async getJobStatus(
    jobId: string,
    apiOriginBackend: string,
  ): Promise<{
    status: string;
    result: StreamSourceResponse | null;
    error: string | null;
  } | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    this.resumeExtractionJobIfStale(job);

    if (
      job.status === 'completed' &&
      (job.result?.videoUrl || job.result?.playerEmbed)
    ) {
      try {
        const result = await this.buildSourceFromJobResult(
          job,
          apiOriginBackend,
        );
        return { status: 'completed', result, error: null };
      } catch (error) {
        dbg(
          `[STREAM] falha ao construir resultado do job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          status: 'failed',
          result: null,
          error: 'Não foi possível preparar a fonte do episódio.',
        };
      }
    }

    if (job.status === 'completed') {
      return {
        status: 'failed',
        result: null,
        error: 'A extração terminou sem encontrar uma fonte de vídeo.',
      };
    }

    if (job.status === 'failed') {
      return {
        status: 'failed',
        result: null,
        error: 'Não foi possível extrair o vídeo. Tente novamente.',
      };
    }

    return { status: job.status, result: null, error: null };
  }

  /**
   * Constrói um StreamSourceResponse a partir de um job completado.
   * Registra `trustMediaHosts` na réplica leitora e formata a resposta.
   */
  private async buildSourceFromJobResult(
    job: {
      animeSlug: string;
      episodeNumber: number;
      season: number;
      result: { videoUrl: string | null; playerEmbed: string | null } | null;
    },
    apiOriginBackend: string,
  ): Promise<StreamSourceResponse> {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: job.animeSlug },
      select: { id: true, slug: true },
    });
    if (!anime) throw new NotFoundException('Anime não encontrado.');

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: anime.id,
          season: job.season,
          number: job.episodeNumber,
        },
      },
      select: {
        id: true,
        number: true,
        videoUrl: true,
        embedUrl: true,
        thumbnailUrl: true,
      },
    });
    if (!episode) throw new NotFoundException('Episódio não encontrado.');

    const rawVideoUrl = job.result!.videoUrl;
    const playerEmbed = job.result!.playerEmbed;

    if (rawVideoUrl) {
      trustMediaHosts([rawVideoUrl]);
    }

    return this.formatStreamSourceResponse({
      animeSlug: anime.slug,
      episodeNumber: episode.number,
      episodeEmbedUrl: episode.embedUrl,
      thumbnailUrl: episode.thumbnailUrl,
      rawVideoUrl,
      playerEmbed,
      reextracted: true,
      apiOriginBackend,
    });
  }

  /**
   * Valida token de streaming. O `ip` DEVE vir do lado server (req socket /
   * x-forwarded-for), nunca de query param do cliente — senão o IP-vinculo é
   * bypassável. Retorna videoUrl + identificadores p/ re-extração em 403.
   */
  async validateToken(
    token: string,
    expires: number,
    ip: string,
  ): Promise<{
    videoUrl: string;
    episodeId: string;
    embedUrl: string | null;
    animeSlug: string;
    animeAudio?: AudioType;
    episodeNumber: number;
    season: number;
  }> {
    const now = Math.floor(Date.now() / 1000);

    if (now > expires) {
      throw new ForbiddenException('Token expirado.');
    }

    const stored = await this.prisma.streamingToken.findUnique({
      where: { token },
    });

    if (!stored) {
      throw new ForbiddenException('Token inválido.');
    }

    if (stored.ip !== ip) {
      throw new ForbiddenException('IP não corresponde ao token.');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Token expirado.');
    }

    const episode = await this.prisma.episode.findUnique({
      where: { id: stored.episodeId },
      include: { anime: { select: { slug: true, audio: true } } },
    });

    if (!episode || !episode.videoUrl) {
      throw new NotFoundException('Vídeo não encontrado.');
    }

    return {
      videoUrl: episode.videoUrl,
      episodeId: episode.id,
      embedUrl: episode.embedUrl ?? null,
      animeSlug: episode.anime.slug,
      animeAudio: episode.anime.audio,
      episodeNumber: episode.number,
      season: episode.season,
    };
  }

  /**
   * Proxy do vídeo: roteia o videoUrl (RAW da CDN) via EmbedService.proxyMedia,
   * que injeta Referer/Origin/UA anti-hotlinking e streama pelo IP de saída
   * do backend (mesmo IP que fez a extração -> resolve IP-vinculo do token da
   * CDN). Repassa Range p/ seek. Em falha recuperável da CDN, re-extrai a
   * fonte via single-flight `runCoalescedScrape` e tenta uma vez mais.
   */
  async proxyVideo(
    token: string,
    expires: number,
    ip: string,
    range?: string,
  ): Promise<{
    status: number;
    headers: Headers;
    body: Readable;
  }> {
    const {
      videoUrl,
      episodeId,
      embedUrl,
      animeSlug,
      animeAudio,
      episodeNumber,
      season,
    } = await this.validateToken(token, expires, ip);

    const reqHeaders: Record<string, string> = {};
    if (range) reqHeaders.range = range;

    const sourceOrigin = refererForMediaUrl(videoUrl);

    let result = await this.embedService.proxyMedia(
      videoUrl,
      reqHeaders,
      sourceOrigin,
    );

    // Fonte indisponível (inclusive 5xx) -> re-extração compartilhada em single-flight e retry único.
    if (shouldReextractMedia(result.status)) {
      console.log(
        `[STREAM] ${result.status} p/ ${animeSlug}/s${season}/${episodeNumber}, re-extraindo...`,
      );
      const { videoUrl: fresh } = await this.runCoalescedScrape(
        { id: episodeId, embedUrl },
        animeSlug,
        episodeNumber,
        season,
        animeAudio,
        true,
      );
      if (fresh) {
        result.body?.destroy();
        const freshOrigin = refererForMediaUrl(fresh);
        result = await this.embedService.proxyMedia(
          fresh,
          reqHeaders,
          freshOrigin,
        );
      }
    }
    if (result.status === 403) {
      throw new ForbiddenException('Vídeo expirado e re-extração falhou.');
    }

    return {
      status: result.status,
      headers: new Headers(result.headers),
      body: result.body,
    };
  }
}
