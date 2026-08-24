import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { EmbedService } from '@/embed/embed.service';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { youtubeEmbedUrl } from '@/embed/scrape/extract';
import {
  probeMediaUrlDead,
  purgeExpiredLivenessCache,
} from '@/common/media-probe';
import { refererForMediaUrl } from '@/common/url-utils';
import { Readable } from 'stream';

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
  /** URL da página do episódio na fonte (ex: animefire.io/animes/<slug>/<ep>). */
  embedUrl: string | null;
  /** se houve re-extração nesta chamada (útil p/ auditoria). */
  reextracted: boolean;
  /** poster opcional do episódio. */
  thumbnailUrl: string | null;
}

@Injectable()
export class StreamingService {
  /** Single-flight + cache curto p/ re-extrações (anti thundering herd no
   *  scraper de chromium, que é caro e concorrencia-limitado). */
  private readonly scrapeInflight = new Map<
    string,
    Promise<{ videoUrl: string | null; youtubeEmbed: string | null }>
  >();
  private readonly scrapeCache = new Map<
    string,
    {
      result: { videoUrl: string | null; youtubeEmbed: string | null };
      at: number;
    }
  >();
  private readonly reextractInflight = new Map<
    string,
    Promise<string | null>
  >();
  private readonly SCRAPE_CACHE_TTL_MS = 5 * 60_000;

  /** Teto de entradas nos caches de inflight — evita crescimento ilimitado
   *  sob carga sustentada (OOM). Entradas mais antigas são descartadas. */
  private static readonly MAX_INFLIGHT_ENTRIES = 200;

  /** Teto de entradas no scrapeCache — evita crescimento indefinido de memória.
   *  Entradas mais antigas (por `at`) são evictadas quando o teto é atingido. */
  private static readonly MAX_SCRAPE_CACHE_ENTRIES = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedService: EmbedService,
    private readonly scrapeService: ScrapeService,
  ) {}

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

  /** Expiração física dos caches em memória, inclusive sem novos acessos. */
  @Cron(CronExpression.EVERY_MINUTE)
  cleanupMemoryCaches(): void {
    const now = Date.now();
    for (const [key, entry] of this.scrapeCache) {
      if (entry.at + this.SCRAPE_CACHE_TTL_MS <= now) {
        this.scrapeCache.delete(key);
      }
    }
    // Eviction por tamanho do scrapeCache — evita crescimento indefinido.
    this.evictScrapeCacheIfNeeded();
    // Eviction por tamanho nos caches de inflight — evita OOM.
    if (this.scrapeInflight.size > StreamingService.MAX_INFLIGHT_ENTRIES) {
      const keys = [...this.scrapeInflight.keys()];
      for (const k of keys.slice(
        0,
        keys.length - StreamingService.MAX_INFLIGHT_ENTRIES,
      )) {
        this.scrapeInflight.delete(k);
      }
    }
    if (this.reextractInflight.size > StreamingService.MAX_INFLIGHT_ENTRIES) {
      const keys = [...this.reextractInflight.keys()];
      for (const k of keys.slice(
        0,
        keys.length - StreamingService.MAX_INFLIGHT_ENTRIES,
      )) {
        this.reextractInflight.delete(k);
      }
    }
    purgeExpiredLivenessCache(now);
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

  async generateToken(
    episodeSlug: string,
    animeSlug: string,
    clientIp: string,
    ttlSeconds: number = 86400,
  ) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
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
  ): Promise<{
    videoUrl: string | null;
    youtubeEmbed: string | null;
    reextracted: boolean;
  }> {
    let rawVideoUrl: string | null = episode.videoUrl;

    dbg(
      `[STREAM] getSource animeSlug=${animeSlug} ep=${episodeNumber} embedUrl=${episode.embedUrl ?? 'null'} videoUrl=${episode.videoUrl?.slice(0, 80) ?? 'null'}`,
    );

    // videoUrl pode estar no formato legado "http://localhost:3001/embed/media?url=..."
    // (wrap que quebra em deploy). Tenta recuperar a URL CRU do parâmetro `url`.
    if (rawVideoUrl && /\/embed\/media\?url=/i.test(rawVideoUrl)) {
      try {
        const u = new URL(rawVideoUrl);
        const inner = u.searchParams.get('url');
        if (inner) rawVideoUrl = inner;
      } catch {
        /* mantém */
      }
    }

    // Em recuperação solicitada pelo player, confirma a falha com um GET de
    // 1 byte antes de gastar um slot de scraper. O probe normal pode decidir
    // URLs assinadas localmente; o forçado precisa confirmar a resposta CDN.
    if (forceRefresh && rawVideoUrl && /^https?:\/\//i.test(rawVideoUrl)) {
      const dead = await probeMediaUrlDead(rawVideoUrl, true);
      dbg(
        `[STREAM] probe forçado videoUrl=${rawVideoUrl.slice(0, 80)} dead=${dead}`,
      );
      if (!dead) {
        return {
          videoUrl: rawVideoUrl,
          youtubeEmbed: null,
          reextracted: false,
        };
      }
      rawVideoUrl = null;
    }

    // videoUrl guardada pode estar morta (token CDN/IP-URL expirado). Nunca
    // devolva uma URL que o probe já confirmou como morta: alguns upstreams
    // mantêm a conexão aberta sem responder e o <video> fica indefinidamente
    // sem metadata (controles/play desabilitados). Nesse caso seguimos para a
    // reextração single-flight abaixo e a primeira navegação já recebe uma
    // fonte utilizável, sem depender de F5.
    if (!forceRefresh && rawVideoUrl && /^https?:\/\//i.test(rawVideoUrl)) {
      const dead = await probeMediaUrlDead(rawVideoUrl);
      dbg(`[STREAM] probe videoUrl=${rawVideoUrl.slice(0, 80)} dead=${dead}`);
      if (dead) {
        dbg(
          `[STREAM] videoUrl morta — re-extraindo antes de responder p/ ${animeSlug}/${episodeNumber}`,
        );
        rawVideoUrl = null;
      }
    }

    if (!forceRefresh && rawVideoUrl && /^https?:\/\//i.test(rawVideoUrl)) {
      return { videoUrl: rawVideoUrl, youtubeEmbed: null, reextracted: false };
    }

    // Sem videoUrl utilizável -> re-extração (single-flight + cache curto).
    const key = `${animeSlug}:${season}:${episodeNumber}`;
    if (forceRefresh) {
      this.scrapeCache.delete(key);
    }
    const cached = this.scrapeCache.get(key);
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.at < this.SCRAPE_CACHE_TTL_MS
    ) {
      dbg(`[STREAM] scrape cache hit p/ ${key}`);
      return { ...cached.result, reextracted: false };
    }
    if (cached) this.scrapeCache.delete(key);

    let inflight = this.scrapeInflight.get(key);
    if (!inflight) {
      inflight = this.doSingleScrape(episode, animeSlug, episodeNumber, season)
        .then((result) => {
          this.scrapeCache.set(key, { result, at: Date.now() });
          return result;
        })
        .finally(() => {
          this.scrapeInflight.delete(key);
        });
      this.scrapeInflight.set(key, inflight);
    }

    const result = await inflight;
    return { ...result, reextracted: true };
  }

  /** Dispara re-extração (single-flight + scrapeCache) sem bloquear o caller.
   *  O doSingleScrape persiste o videoUrl fresco no DB e aquece o scrapeCache,
   *  de modo que a próxima chamada (inclusive o recovery refresh=1 do player)
   *  encontra o resultado pronto ou compartilha o scrape em andamento. */
  private kickBackgroundScrape(
    episode: { id: string; embedUrl: string | null },
    animeSlug: string,
    episodeNumber: number,
    season: number,
  ): void {
    const key = `${animeSlug}:${season}:${episodeNumber}`;
    if (this.scrapeInflight.has(key)) return;
    const cached = this.scrapeCache.get(key);
    if (cached && Date.now() - cached.at < this.SCRAPE_CACHE_TTL_MS) return;
    if (cached) this.scrapeCache.delete(key);
    const inflight = this.doSingleScrape(
      episode,
      animeSlug,
      episodeNumber,
      season,
    )
      .then((result) => {
        this.scrapeCache.set(key, { result, at: Date.now() });
        return result;
      })
      .finally(() => {
        this.scrapeInflight.delete(key);
      })
      .catch(() => ({ videoUrl: null, youtubeEmbed: null }));
    this.scrapeInflight.set(key, inflight);
  }

  /** Scrape real (fora do single-flight): fonte original + fallback meusanimes. */
  private async doSingleScrape(
    episode: { id: string; embedUrl: string | null },
    animeSlug: string,
    episodeNumber: number,
    season: number,
  ): Promise<{ videoUrl: string | null; youtubeEmbed: string | null }> {
    let rawVideoUrl: string | null = null;
    let youtubeEmbed: string | null = null;

    // Tentativa 1: fonte original (embedUrl)
    if (episode.embedUrl) {
      dbg(
        `[STREAM] tentativa 1: scrapeEpisodeVideo(embedUrl=${episode.embedUrl.slice(0, 80)})`,
      );
      try {
        const result = await this.scrapeService.scrapeEpisodeVideo(
          episode.embedUrl,
          undefined,
          false,
          true,
        );
        rawVideoUrl = result.videos[0] ?? null;
        youtubeEmbed =
          (result.playerTokens ?? []).find((t) => youtubeEmbedUrl(t)) ?? null;
        dbg(
          `[STREAM] tentativa 1 resultado: videos=${result.videos.length} rawVideoUrl=${rawVideoUrl?.slice(0, 80) ?? 'null'} youtubeEmbed=${youtubeEmbed?.slice(0, 60) ?? 'null'}`,
        );
      } catch (err) {
        dbg(
          `[STREAM] tentativa 1 FALHOU: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Tentativa 2: fallback meusanimes.blog
    if (!rawVideoUrl) {
      dbg(
        `[STREAM] tentativa 2: scrapeFromMeusanimes(${animeSlug}, ${episodeNumber}, s${season})`,
      );
      rawVideoUrl = await this.scrapeService.scrapeFromMeusanimes(
        animeSlug,
        episodeNumber,
        season,
      );
      dbg(
        `[STREAM] tentativa 2 resultado: ${rawVideoUrl?.slice(0, 80) ?? 'null'}`,
      );
    }

    // Persiste RAW (sem wrap) p/ próximas chamadas.
    if (rawVideoUrl) {
      await this.prisma.episode
        .update({
          where: { id: episode.id },
          data: { videoUrl: rawVideoUrl },
        })
        .catch(() => undefined);
    }

    return { videoUrl: rawVideoUrl, youtubeEmbed };
  }

  /**
   * Origem do stream público (sem JWT). Resolve o videoUrl de um episódio:
   *
   * 1. Se `episode.videoUrl` já existe válido (CRU, sem wrap localhost),
   *    usa direto.
   * 2. Senão, se `episode.embedUrl` aponta p/ uma fonte com extractHttp
   *    (animefire), re-extrai o mp4 token IP-bound ao backend e persiste.
   * 3. Senão lança NotFound.
   *
   * Retorna `src` já envolvido no proxy de mídia interno (`/embed/media`), de
   * modo que o browser só fala com o próprio backend — Referer/Origin/UA
   * anti-hotlinking resolvidos server-side, IP-vínculo do token da CDN
   * satisfeito pelo IP de saída do backend.
   *
   * `apiOriginBackend` (ex: https://api.animesice.io) é passado pelo
   * controller para montar a URL absoluta quando o videoUrl é RAW externo.
   * Se `videoUrl` já estiver wrap em `/embed/media` relativo (formato antigo
   * com localhost), detecta e devolve como absoluta contra apiOriginBackend.
   */
  async getSource(
    animeSlug: string,
    episodeNumber: number,
    apiOriginBackend: string,
    season: number = 1,
    forceRefresh = false,
  ): Promise<StreamSourceResponse> {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true, slug: true },
    });
    if (!anime) {
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

    const {
      videoUrl: rawVideoUrl,
      youtubeEmbed,
      reextracted,
    } = await this.resolveVideo(
      episode,
      anime.slug,
      episodeNumber,
      season,
      forceRefresh,
    );

    if (!rawVideoUrl && !youtubeEmbed) {
      throw new NotFoundException(
        'Vídeo não disponível: re-extração falhou em todas as fontes.',
      );
    }

    // Fonte é player do YouTube (embed): não há .mp4 server-side extraível
    // (YouTube bloqueia IPs datacenter com LOGIN_REQUIRED). O embed reproduz
    // no browser do usuário via iframe — src aponta direto p/ o embed.
    if (youtubeEmbed && !rawVideoUrl) {
      dbg(`[STREAM] fonte é YouTube embed — servindo iframe: ${youtubeEmbed}`);
      return {
        animeSlug: anime.slug,
        episodeNumber: episode.number,
        src: youtubeEmbed,
        rawVideoUrl: youtubeEmbed,
        embedUrl: youtubeEmbed,
        reextracted,
        thumbnailUrl: episode.thumbnailUrl,
      };
    }

    // Monta src final: proxy de mídia do backend (absoluto + prefixo api).
    const base = apiOriginBackend.replace(/\/$/, '');
    const apiPrefix = process.env.API_PREFIX || 'api';
    const src = `${base}/${apiPrefix}${wrapMediaUrl(rawVideoUrl!)}`;

    return {
      animeSlug: anime.slug,
      episodeNumber: episode.number,
      src,
      rawVideoUrl,
      embedUrl: episode.embedUrl,
      reextracted,
      thumbnailUrl: episode.thumbnailUrl,
    };
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
    animeSlug: string;
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
      include: { anime: { select: { slug: true } } },
    });

    if (!episode || !episode.videoUrl) {
      throw new NotFoundException('Vídeo não encontrado.');
    }

    return {
      videoUrl: episode.videoUrl,
      episodeId: episode.id,
      animeSlug: episode.anime.slug,
      episodeNumber: episode.number,
      season: episode.season,
    };
  }

  /**
   * Proxy do vídeo: roteia o videoUrl (RAW da CDN) via EmbedService.proxyMedia,
   * que injeta Referer/Origin/UA anti-hotlinking e streama pelo IP de saída
   * do backend (mesmo IP que fez a extração -> resolve IP-vinculo do token da
   * CDN). Repassa Range p/ seek. Em 403 (token CDN expirado), re-extrai a
   * fonte via ScrapeService.reextractEpisodeVideo e tenta uma vez mais.
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
    const { videoUrl, animeSlug, episodeNumber, season } =
      await this.validateToken(token, expires, ip);

    const reqHeaders: Record<string, string> = {};
    if (range) reqHeaders.range = range;

    // Referer dinâmico por host da CDN (googlevideo vs lightspeedst).
    const sourceOrigin = refererForMediaUrl(videoUrl);

    let result = await this.embedService.proxyMedia(
      videoUrl,
      reqHeaders,
      sourceOrigin,
    );

    // 403 = token .mp4 da CDN expirado -> re-extração e retry único.
    if (result.status === 403) {
      console.log(
        `[STREAM] 403 p/ ${animeSlug}/s${season}/${episodeNumber}, re-extraindo...`,
      );
      // Single-flight: N viewers com 403 compartilham UMA re-extração (o
      // scraper é caro e concorrencia-limitado).
      const key = `${animeSlug}:${season}:${episodeNumber}`;
      let inflight = this.reextractInflight.get(key);
      if (!inflight) {
        inflight = (async () => {
          // Tenta re-extração da fonte original.
          let fresh = await this.scrapeService.reextractEpisodeVideo(
            animeSlug,
            episodeNumber,
            season,
          );
          // Fallback meusanimes.
          if (!fresh) {
            fresh = await this.scrapeService.scrapeFromMeusanimes(
              animeSlug,
              episodeNumber,
              season,
            );
          }
          return fresh;
        })().finally(() => {
          this.reextractInflight.delete(key);
        });
        this.reextractInflight.set(key, inflight);
      }
      const fresh = await inflight;
      if (fresh) {
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
