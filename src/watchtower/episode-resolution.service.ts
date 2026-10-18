/**
 * EpisodeResolution — módulo profundo do Watchtower que consolida descoberta
 * de candidatas por fonte, extração de mídia (HTTP / Playwright), validação
 * de liveness (probeMediaUrlDead), persistência atômica (Episode + EpisodeSource),
 * notificações NEW_EPISODE e a invariante de publicação/despublicação do Anime
 * (`catalogUnpublished`).
 *
 * Substitui o quarteto raso SourceDiscovery + Extractor + Validator + Publisher
 * e elimina a duplicação de `unpublishIfFullyBroken` / `embedUrlForSource`.
 */
import { Injectable } from '@nestjs/common';
import type { AudioType } from '@prisma/client';
import { probeMediaUrlDead } from '@/common/media-probe';
import { ScrapeService } from '@/embed/scrape/scrape.service';
import { NotificationService } from '@/notification/notification.service';
import { PrismaService } from '@/prisma/prisma.service';
import { HealthMonitor } from './health-monitor.service';
import { SOURCE_IDS, sourceEpisodeUrlVariants } from './watchtower.types';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface SourceCandidate {
  sourceId: string;
  url: string;
}

export type ProbeStatus = 'ok' | 'missing' | 'blocked' | 'inconclusive';

export interface EpisodeCandidate {
  videoUrl: string;
  embedUrl?: string | null;
  thumbnailUrl?: string | null;
  title?: string | null;
  duration?: string | null;
  sourceId: string;
}

export interface ExtractResult {
  candidates: EpisodeCandidate[];
  triedSources: string[];
}

export interface PublishInput {
  animeId: string;
  episodeNumber: number;
  season?: number;
  videoUrl: string;
  embedUrl: string;
  sourceId: string;
  sources?: Array<{ sourceId: string; pageUrl: string }>;
  thumbnailUrl?: string | null;
  title?: string | null;
  duration?: string | null;
}

export interface ResolveAndPublishInput {
  animeId: string;
  slug?: string;
  episodeNumber: number;
  season?: number;
  episodeUrl?: string;
  rustFallbackUrl?: string;
  rustFallbackSourceId?: string;
  mode?: 'extract' | 'repair';
}

@Injectable()
export class EpisodeResolution {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scrape: ScrapeService,
    private readonly health: HealthMonitor,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Orquestra a resolução ponta-a-ponta de um episódio (`EXTRACT_EPISODE` ou
   * `REPAIR_EPISODE`):
   *  1. Em `repair`, se o episódio não existe, cai para `extract`. Se o vídeo
   *     atual ainda responde vivo no probe, limpa `videoBroken` e encerra.
   *  2. Descobre e extrai candidatas ordenadas por saúde (ou executa handoff
   *     direcionado `extractExact` vindo do worker Rust).
   *  3. Valida liveness dos vídeos extraídos (`pickValidSources`) e registra
   *     falha de `VALIDATION` no `HealthMonitor` quando todos estão mortos.
   *  4. Persiste `Episode` + `EpisodeSource`, republica o `Anime` se estava
   *     despublicado por quebra/catálogo e emite `NEW_EPISODE` se inédito.
   */
  async resolveAndPublish(input: ResolveAndPublishInput): Promise<void> {
    const mode = input.mode ?? 'extract';
    const season = input.season ?? 1;

    if (mode === 'repair') {
      const episode = await this.prisma.episode.findUnique({
        where: {
          animeId_season_number: {
            animeId: input.animeId,
            season,
            number: input.episodeNumber,
          },
        },
        select: { id: true, animeId: true, number: true, embedUrl: true },
      });
      if (!episode) {
        await this.resolveAndPublish({
          animeId: input.animeId,
          slug:
            input.slug ||
            ((
              await this.prisma.anime.findUnique({
                where: { id: input.animeId },
                select: { slug: true },
              })
            )?.slug ??
              ''),
          episodeNumber: input.episodeNumber,
          season,
          mode: 'extract',
        });
        return;
      }

      const anime = await this.prisma.anime.findUnique({
        where: { id: input.animeId },
        select: { id: true, slug: true, coverImage: true, audio: true },
      });
      if (!anime) throw new Error(`Anime ${input.animeId} não encontrado`);

      const current = await this.prisma.episode.findUnique({
        where: { id: episode.id },
        select: { videoUrl: true },
      });
      if (current?.videoUrl) {
        const dead = await probeMediaUrlDead(current.videoUrl);
        if (!dead) {
          await this.prisma.episode.update({
            where: { id: episode.id },
            data: { videoBroken: false, videoCheckedAt: new Date() },
          });
          return;
        }
      }

      await this.prisma.episode
        .update({
          where: { id: episode.id },
          data: { videoBroken: true },
        })
        .catch(() => undefined);
      await this.unpublishIfFullyBroken(anime.id);

      const { candidates } =
        input.rustFallbackUrl && input.rustFallbackSourceId
          ? await this.extractExact(
              input.rustFallbackSourceId,
              input.rustFallbackUrl,
              input.rustFallbackSourceId,
              anime.audio,
            )
          : await this.extract(
              anime.slug,
              input.episodeNumber,
              season,
              episode.embedUrl ?? undefined,
              anime.audio,
            );
      if (candidates.length === 0) {
        await this.unpublishIfFullyBroken(anime.id);
        throw new Error(
          `Repair: sem fonte p/ ${anime.slug}/${input.episodeNumber}`,
        );
      }

      const validSources = await this.pickValidSources(candidates, anime.id);
      const valid = validSources[0];
      if (!valid) {
        for (const c of candidates) {
          await this.health.recordFailure(c.sourceId, {
            kind: 'VALIDATION',
            error: 'URL de mídia rejeitada pela validação',
          });
        }
        await this.unpublishIfFullyBroken(anime.id);
        throw new Error(
          `Repair: validação falhou ${anime.slug}/${input.episodeNumber}`,
        );
      }

      const embedUrl =
        valid.embedUrl ??
        this.fallbackEmbedUrl(
          valid.sourceId,
          anime.slug,
          input.episodeNumber,
          season,
        );
      await this.publish({
        animeId: anime.id,
        episodeNumber: input.episodeNumber,
        season,
        videoUrl: valid.videoUrl,
        embedUrl,
        sourceId: valid.sourceId,
        sources: validSources.map((candidate) => ({
          sourceId: candidate.sourceId,
          pageUrl:
            candidate.embedUrl ??
            this.fallbackEmbedUrl(
              candidate.sourceId,
              anime.slug,
              input.episodeNumber,
              season,
            ),
        })),
        thumbnailUrl: valid.thumbnailUrl ?? anime.coverImage,
        title: `Episódio ${input.episodeNumber}`,
      });
      return;
    }

    const anime = await this.prisma.anime.findUnique({
      where: { id: input.animeId },
      select: { id: true, slug: true, coverImage: true, audio: true },
    });
    if (!anime) throw new Error(`Anime ${input.animeId} não encontrado`);

    const { candidates } = await this.extract(
      anime.slug,
      input.episodeNumber,
      season,
      input.episodeUrl,
      anime.audio,
    );
    if (candidates.length === 0) {
      await this.markEpisodeBrokenIfAny(anime.id, season, input.episodeNumber);
      throw new Error(
        `Nenhuma fonte resolveu ${anime.slug}/s${season}/${input.episodeNumber}`,
      );
    }

    const validSources = await this.pickValidSources(candidates, anime.id);
    const valid = validSources[0];
    if (!valid) {
      for (const c of candidates) {
        await this.health.recordFailure(c.sourceId, {
          kind: 'VALIDATION',
          error: 'URL de mídia rejeitada pela validação',
        });
      }
      await this.markEpisodeBrokenIfAny(anime.id, season, input.episodeNumber);
      throw new Error(
        `Validação falhou p/ ${anime.slug}/s${season}/${input.episodeNumber} (vídeos mortos)`,
      );
    }

    const embedUrl =
      valid.embedUrl ??
      this.fallbackEmbedUrl(
        valid.sourceId,
        anime.slug,
        input.episodeNumber,
        season,
      );
    await this.publish({
      animeId: anime.id,
      episodeNumber: input.episodeNumber,
      season,
      videoUrl: valid.videoUrl,
      embedUrl,
      sourceId: valid.sourceId,
      sources: validSources.map((candidate) => ({
        sourceId: candidate.sourceId,
        pageUrl:
          candidate.embedUrl ??
          this.fallbackEmbedUrl(
            candidate.sourceId,
            anime.slug,
            input.episodeNumber,
            season,
          ),
      })),
      thumbnailUrl: valid.thumbnailUrl ?? anime.coverImage,
      title: valid.title ?? `Episódio ${input.episodeNumber}`,
      duration: valid.duration,
    });
  }

  /**
   * Candidatas ordenadas por health da fonte.
   * Usa `ScrapeService.resolveCandidateUrlsForSource` (2 passos: variantes de
   * slug no template + fallback na listagem da página do anime) quando disponível,
   * caindo para `sourceEpisodeUrlVariants` como fallback estático.
   */
  async candidates(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
    episodeUrl?: string,
  ): Promise<SourceCandidate[]> {
    const order = await this.health.rankedSources();
    const out: SourceCandidate[] = [];

    if (episodeUrl) {
      const explicit = this.explicitCandidate(episodeUrl);
      if (explicit && !(await this.health.isDisabled(explicit.sourceId))) {
        const status = await this.probeExists(explicit.url);
        if (status !== 'missing') out.push(explicit);
      }
    }

    const usedSources = new Set(out.map((c) => c.sourceId));
    const onlyExplicit = episodeUrl ? usedSources : new Set<string>();

    for (const sourceId of order) {
      if (onlyExplicit.has(sourceId)) continue;
      let urls =
        typeof this.scrape.resolveCandidateUrlsForSource === 'function'
          ? await this.scrape.resolveCandidateUrlsForSource(
              sourceId,
              animeSlug,
              episodeNumber,
              season,
            )
          : [];
      if (urls.length === 0) {
        urls = sourceEpisodeUrlVariants(
          sourceId,
          animeSlug,
          episodeNumber,
          season,
        );
      }

      const ok: SourceCandidate[] = [];
      const blocked: SourceCandidate[] = [];
      const inconclusive: SourceCandidate[] = [];

      for (const url of urls) {
        const status = await this.probeExists(url);
        if (status === 'ok') ok.push({ sourceId, url });
        else if (status === 'blocked') blocked.push({ sourceId, url });
        else if (status === 'inconclusive')
          inconclusive.push({ sourceId, url });
      }

      if (ok.length > 0) {
        out.push(ok[0]!);
      } else if (inconclusive.length > 0) {
        out.push(inconclusive[0]!);
      } else if (blocked.length > 0) {
        out.push(blocked[0]!);
      }
    }
    return out;
  }

  /** Todas as URLs candidatas de template (sem probe). */
  allCandidates(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
  ): SourceCandidate[] {
    const out: SourceCandidate[] = [];
    for (const sourceId of SOURCE_IDS) {
      for (const url of sourceEpisodeUrlVariants(
        sourceId,
        animeSlug,
        episodeNumber,
        season,
      )) {
        out.push({ sourceId, url });
      }
    }
    return out;
  }

  exactCandidate(episodeUrl: string, sourceId: string): SourceCandidate | null {
    const candidate = this.explicitCandidate(episodeUrl);
    return candidate?.sourceId === sourceId ? candidate : null;
  }

  async extract(
    animeSlug: string,
    episodeNumber: number,
    season: number = 1,
    episodeUrl?: string,
    audio?: AudioType,
  ): Promise<ExtractResult> {
    const candidates = await this.candidates(
      animeSlug,
      episodeNumber,
      season,
      episodeUrl,
    );
    if (candidates.length === 0) {
      return { candidates: [], triedSources: [] };
    }

    const out: EpisodeCandidate[] = [];
    const tried: string[] = [];

    for (const c of candidates) {
      tried.push(c.sourceId);
      try {
        const result = await this.scrape.scrapeEpisodeVideo(
          c.url,
          c.sourceId,
          false,
          false,
          audio,
        );
        const videoUrl = result.videos[0];
        if (!videoUrl) continue;

        out.push({
          videoUrl,
          sourceId: c.sourceId,
          embedUrl: c.url,
          thumbnailUrl: null,
          title: null,
          duration: null,
        });
      } catch (err) {
        console.error(
          `[WATCHTOWER] extract falhou ${c.sourceId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return { candidates: out, triedSources: tried };
  }

  async extractExact(
    sourceId: string,
    pageUrl: string,
    expectedSourceId: string,
    audio?: AudioType,
  ): Promise<ExtractResult> {
    const candidate = this.exactCandidate(pageUrl, expectedSourceId);
    if (!candidate || candidate.sourceId !== sourceId) {
      throw new Error('Handoff Rust contém URL/fonte incompatíveis');
    }
    const result = await this.scrape.scrapeEpisodeVideo(
      candidate.url,
      candidate.sourceId,
      false,
      false,
      audio,
    );
    return {
      candidates: result.videos.map((videoUrl) => ({
        videoUrl,
        sourceId: candidate.sourceId,
        embedUrl: candidate.url,
        thumbnailUrl: null,
        title: null,
        duration: null,
      })),
      triedSources: [candidate.sourceId],
    };
  }

  async pickValid(
    candidates: EpisodeCandidate[],
    animeId: string,
  ): Promise<EpisodeCandidate | null> {
    return (await this.pickValidSources(candidates, animeId, 1))[0] ?? null;
  }

  async pickValidSources(
    candidates: EpisodeCandidate[],
    animeId: string,
    limit = 2,
  ): Promise<EpisodeCandidate[]> {
    let animeCover: string | null = null;
    const valid: EpisodeCandidate[] = [];
    const seenSources = new Set<string>();

    for (const c of candidates) {
      if (!c.videoUrl || seenSources.has(c.sourceId)) continue;
      const dead = await probeMediaUrlDead(c.videoUrl);
      if (dead) continue;
      seenSources.add(c.sourceId);
      if (!c.thumbnailUrl) {
        if (animeCover === null) {
          const a = await this.prisma.anime.findUnique({
            where: { id: animeId },
            select: { coverImage: true },
          });
          animeCover = a?.coverImage ?? null;
        }
        c.thumbnailUrl = animeCover;
      }
      valid.push(c);
      if (valid.length >= limit) break;
    }
    return valid;
  }

  async publish(input: PublishInput): Promise<void> {
    const season = input.season ?? 1;
    const existing = await this.prisma.episode.findUnique({
      where: {
        animeId_season_number: {
          animeId: input.animeId,
          season,
          number: input.episodeNumber,
        },
      },
      select: { id: true },
    });

    const episode = await this.prisma.episode.upsert({
      where: {
        animeId_season_number: {
          animeId: input.animeId,
          season,
          number: input.episodeNumber,
        },
      },
      update: {
        videoUrl: input.videoUrl,
        embedUrl: input.embedUrl,
        sourceId: input.sourceId,
        videoBroken: false,
        videoCheckedAt: new Date(),
        dateModified: new Date(),
        ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.duration ? { duration: input.duration } : {}),
      },
      create: {
        animeId: input.animeId,
        season,
        number: input.episodeNumber,
        videoUrl: input.videoUrl,
        embedUrl: input.embedUrl,
        sourceId: input.sourceId,
        videoBroken: false,
        videoCheckedAt: new Date(),
        title: input.title ?? `Episódio ${input.episodeNumber}`,
        thumbnailUrl: input.thumbnailUrl ?? null,
        duration: input.duration ?? null,
      },
    });

    const animeAudio = await this.prisma.anime.findUnique({
      where: { id: input.animeId },
      select: { audio: true },
    });
    if (animeAudio) {
      const sources = input.sources?.length
        ? input.sources
        : [{ sourceId: input.sourceId, pageUrl: input.embedUrl }];
      for (const source of sources) {
        await this.prisma.episodeSource?.upsert({
          where: {
            episodeId_sourceId: {
              episodeId: episode.id,
              sourceId: source.sourceId,
            },
          },
          update: {
            pageUrl: source.pageUrl,
            audio: animeAudio.audio,
            verifiedAt: new Date(),
            lastError: null,
          },
          create: {
            episodeId: episode.id,
            sourceId: source.sourceId,
            pageUrl: source.pageUrl,
            audio: animeAudio.audio,
            verifiedAt: new Date(),
          },
        });
      }
      await this.prisma.anime.updateMany({
        where: { id: episode.animeId, published: false },
        data: {
          published: true,
          catalogUnpublished: false,
          catalogAbsentChecks: 0,
          catalogAbsenceCheckedAt: null,
        },
      });
    }

    if (!existing) {
      const anime = await this.prisma.anime.findUnique({
        where: { id: input.animeId },
        select: { slug: true, title: true },
      });
      if (anime) {
        void this.notifications
          .notifyNewEpisode(
            input.animeId,
            anime.title,
            input.episodeNumber,
            anime.slug,
          )
          .catch(() => undefined);
      }
    }
  }

  /** Marca anime como FINALIZADO quando airingSchedule indica fim. */
  async markAnimeComplete(animeId: string): Promise<void> {
    await this.prisma.anime
      .update({
        where: { id: animeId },
        data: { status: 'FINALIZADO' },
      })
      .catch(() => undefined);
  }

  async markEpisodeBrokenIfAny(
    animeId: string,
    season: number,
    episodeNumber: number,
  ): Promise<void> {
    await this.prisma.episode
      .updateMany({
        where: {
          animeId,
          season,
          number: episodeNumber,
          videoBroken: false,
        },
        data: { videoBroken: true, videoCheckedAt: new Date() },
      })
      .catch(() => undefined);
    await this.unpublishIfFullyBroken(animeId);
  }

  /**
   * Se todos os episódios do anime ficaram sem vídeo, despublica para não
   * dar falsa esperança ao usuário. Volta sozinho quando um episódio for
   * (re)publicado.
   */
  async unpublishIfFullyBroken(animeId: string): Promise<void> {
    const anime = await this.prisma.anime.findUnique({
      where: { id: animeId },
      select: { id: true, published: true },
    });
    if (!anime || !anime.published) return;
    const working = await this.prisma.episode.count({
      where: {
        animeId,
        videoBroken: false,
        videoUrl: { not: null },
        NOT: { videoUrl: '' },
      },
    });
    if (working > 0) return;
    await this.prisma.anime
      .update({
        where: { id: animeId },
        data: { published: false, catalogUnpublished: true },
      })
      .catch(() => undefined);
  }

  private fallbackEmbedUrl(
    sourceId: string,
    slug: string,
    ep: number,
    season: number = 1,
  ): string {
    if (sourceId === 'animefire') {
      return `https://animefire.io/animes/${slug}/${ep}`;
    }
    const variants = sourceEpisodeUrlVariants(sourceId, slug, ep, season);
    return variants[0] ?? '';
  }

  private explicitCandidate(episodeUrl: string): SourceCandidate | null {
    const lower = episodeUrl.toLowerCase();
    if (/meusanimes\.blog|meusdoramas\.club/i.test(lower)) {
      return { sourceId: 'meusanimes', url: episodeUrl };
    }
    if (/animefire\.io/i.test(lower)) {
      return { sourceId: 'animefire', url: episodeUrl };
    }
    if (/animesonlinecc\.to|animesonline\.cloud/i.test(lower)) {
      return { sourceId: 'animesonline', url: episodeUrl };
    }
    if (/animesdigital\.org/i.test(lower)) {
      return { sourceId: 'animesdigital', url: episodeUrl };
    }
    if (/topanimes\.net/i.test(lower)) {
      return { sourceId: 'topanimes', url: episodeUrl };
    }
    if (/animesorion\.cc|animexhd\.xyz/i.test(lower)) {
      return { sourceId: 'animesorion', url: episodeUrl };
    }
    return null;
  }

  private async probeExists(url: string): Promise<ProbeStatus> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'user-agent': UA,
          accept: 'text/html',
          'accept-language': 'pt-BR',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      await res.body?.cancel();

      if (res.status >= 200 && res.status < 400) return 'ok';
      if (res.status === 404 || res.status === 410) return 'missing';
      return 'blocked';
    } catch {
      return 'inconclusive';
    }
  }
}
