import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { EmbedService } from '@/embed/embed.service';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { probeMediaUrlDead } from '@/common/media-probe';
import { Readable } from 'stream';

function dbg(msg: string): void {
  const safeMsg = msg.replace(/[\r\n\u2028\u2029]/g, ' ');
  console.error(`${new Date().toISOString()} ${safeMsg}`);
}

/**
 * Origem da fonte, injetada como Referer/Origin no proxy de mídia anti-hotlink.
 * Derivada por host: googlevideo exige youtube.googleapis.com,
 * lightspeedst exige animefire.io.
 */
/**
 * Resolve o Referer correto para a URL de mídia com base no host da CDN.
 * - googlevideo.com (vindo de Blogger/YouTube): exige Referer youtube.googleapis.com
 * - lightspeedst.net (vindo de animefire): exige Referer animefire.io
 * - default: origem da própria URL
 */
function refererForMediaUrl(mediaUrl: string): string {
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
    return 'https://animefire.io/';
  }
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedService: EmbedService,
    private readonly scrapeService: ScrapeService,
  ) {}

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

    const episode = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: anime.id,
          season: 1,
          number: parseInt(episodeSlug, 10),
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

    let rawVideoUrl: string | null = episode.videoUrl;
    let reextracted = false;

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

    // videoUrl guardada pode estar morta (token CDN/IP-URL expirado). Probe
    // leve e, se morta, zera para o fluxo de re-extração abaixo recompor.
    if (rawVideoUrl && /^https?:\/\//i.test(rawVideoUrl)) {
      const dead = await probeMediaUrlDead(rawVideoUrl);
      dbg(`[STREAM] probe videoUrl=${rawVideoUrl.slice(0, 80)} dead=${dead}`);
      if (dead) {
        dbg(
          `[STREAM] videoUrl morta — forçando re-extração p/ ${animeSlug}/${episodeNumber}`,
        );
        rawVideoUrl = null;
      }
    }

    // Sem videoUrl utilizável -> tenta re-extração.
    // 1ª tentativa: embedUrl do episódio (geralmente animefire.io).
    // 2ª tentativa (fallback): meusanimes.blog se animefire bloquear (403 CF).
    if (!rawVideoUrl || !/^https?:\/\//i.test(rawVideoUrl)) {
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
          );
          rawVideoUrl = result.videos[0] ?? null;
          dbg(
            `[STREAM] tentativa 1 resultado: videos=${result.videos.length} rawVideoUrl=${rawVideoUrl?.slice(0, 80) ?? 'null'}`,
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
          `[STREAM] tentativa 2: scrapeFromMeusanimes(${animeSlug}, ${episodeNumber})`,
        );
        rawVideoUrl = await this.scrapeService.scrapeFromMeusanimes(
          animeSlug,
          episodeNumber,
        );
        dbg(
          `[STREAM] tentativa 2 resultado: ${rawVideoUrl?.slice(0, 80) ?? 'null'}`,
        );
      }

      if (!rawVideoUrl) {
        dbg(`[STREAM] ambas tentativas falharam — 404`);
        throw new NotFoundException(
          'Vídeo não disponível: re-extração falhou em todas as fontes.',
        );
      }

      // Persiste RAW (sem wrap) p/ próximas chamadas.
      await this.prisma.episode.update({
        where: { id: episode.id },
        data: { videoUrl: rawVideoUrl },
      });
      reextracted = true;
    }

    // Monta src final: proxy de mídia do backend (absoluto + prefixo api).
    const base = apiOriginBackend.replace(/\/$/, '');
    const apiPrefix = process.env.API_PREFIX || 'api';
    const src = `${base}/${apiPrefix}${wrapMediaUrl(rawVideoUrl)}`;

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
    const { videoUrl, animeSlug, episodeNumber } = await this.validateToken(
      token,
      expires,
      ip,
    );

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
        `[STREAM] 403 p/ ${animeSlug}/${episodeNumber}, re-extraindo...`,
      );
      // Tenta re-extração da fonte original.
      let fresh = await this.scrapeService.reextractEpisodeVideo(
        animeSlug,
        episodeNumber,
      );
      // Fallback meusanimes.
      if (!fresh) {
        fresh = await this.scrapeService.scrapeFromMeusanimes(
          animeSlug,
          episodeNumber,
        );
      }
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
