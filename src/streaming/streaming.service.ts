import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { EmbedService } from '@/embed/embed.service';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { Readable } from 'stream';

/**
 * Origem da fonte, injetada como Referer/Origin no proxy de mídia anti-hotlink.
 * Hoje a única fonte HTTP pura é animefire; se surgirem mais, derive por host
 * do videoUrl ou adicione uma coluna `sourceOrigin` em Episode.
 */
const DEFAULT_SOURCE_ORIGIN = 'https://animefire.io';

/**
 * Helper que envolve uma URL externa (.mp4/.m3u8) no proxy de mídia interno
 * `/embed/media?url=...&referer=<sourceOrigin>` — assim o client (browser)
 * consome pelo mesmo host do backend, injetando Referer/Origin/UA anti-hotlinking
 * e usando o IP de saída do backend (mesmo IP que extraiu o token da CDN).
 */
function wrapMediaUrl(
  raw: string,
  sourceOrigin = DEFAULT_SOURCE_ORIGIN,
): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  return `/embed/media?url=${encodeURIComponent(trimmed)}&referer=${encodeURIComponent(sourceOrigin)}`;
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
        animeId_number: {
          animeId: anime.id,
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

    return {
      url: `${episode.videoUrl}?token=${token}&expires=${expiresUnix}&ip=${clientIp}`,
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
        animeId_number: { animeId: anime.id, number: episodeNumber },
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

    // Sem videoUrl utilizável -> tenta re-extração via ScrapeService.
    if (!rawVideoUrl || !/^https?:\/\//i.test(rawVideoUrl)) {
      if (!episode.embedUrl) {
        throw new NotFoundException(
          'Vídeo não disponível: episódio sem videoUrl e sem embedUrl p/ re-extração.',
        );
      }
      const source = this.scrapeService.findHttpSource(episode.embedUrl);
      if (!source || !source.extractHttp) {
        throw new NotFoundException(
          'Vídeo não disponível: fonte não suporta extração HTTP.',
        );
      }
      try {
        const result = await source.extractHttp({
          episodeUrl: episode.embedUrl,
          ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        });
        rawVideoUrl = result.videos[0] ?? null;
      } catch (err) {
        console.log(
          `[STREAM/SOURCE] re-extração falhou p/ ${animeSlug}/${episodeNumber}:`,
          err instanceof Error ? err.message : String(err),
        );
        throw new NotFoundException(
          'Vídeo não disponível: re-extração falhou.',
        );
      }
      if (!rawVideoUrl) {
        throw new NotFoundException('Vídeo não disponível: extração vazia.');
      }
      // Persiste RAW (sem wrap) p/ próximas chamadas e p/ re-extração 403.
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

    let result = await this.embedService.proxyMedia(
      videoUrl,
      reqHeaders,
      DEFAULT_SOURCE_ORIGIN,
    );

    // 403 = token .mp4 da CDN expirado -> re-extração e retry único.
    if (result.status === 403) {
      console.log(
        `[STREAM] 403 p/ ${animeSlug}/${episodeNumber}, re-extraindo...`,
      );
      const fresh = await this.scrapeService.reextractEpisodeVideo(
        animeSlug,
        episodeNumber,
      );
      if (fresh) {
        result = await this.embedService.proxyMedia(
          fresh,
          reqHeaders,
          DEFAULT_SOURCE_ORIGIN,
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
