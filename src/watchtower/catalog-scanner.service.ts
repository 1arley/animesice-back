import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JobsService } from './jobs.service';
import { JOB_TYPE, PRIORITY } from './watchtower.types';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface CatalogEntry {
  season: number;
  episode: number;
  /** URL real do episódio publicada no catálogo (filmes usam /e/<slug>/). */
  url: string;
}

@Injectable()
export class CatalogScanner implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    console.error(
      '[CATALOG] scanner carregado — escaneamento sob demanda via SCAN_CATALOG job',
    );
  }

  /**
   * Escaneia um anime específico no meusanimes.blog e retorna todas as temporadas+episódios.
   * Se o slug sibling (ex: "kaguya-sama-love-is-war-2") 404, tenta o slug base
   * (ex: "kaguya-sama-love-is-war") — meusanimes publica todas temporadas na mesma página.
   */
  async scanAnime(animeSlug: string): Promise<CatalogEntry[]> {
    const entries = await this.tryScan(animeSlug);
    if (entries.length > 0) return entries;

    // Slug sibling 404 — tenta slug base (sem sufixo de temporada)
    const baseSlug = animeSlug.replace(/-\d+$/, '');
    if (baseSlug !== animeSlug) {
      console.error(
        `[CATALOG] ${animeSlug} vazio — tentando slug base: ${baseSlug}`,
      );
      return this.tryScan(baseSlug);
    }
    return [];
  }

  private async tryScan(animeSlug: string): Promise<CatalogEntry[]> {
    const url = `https://meusanimes.blog/a/${animeSlug}/`;
    console.error(`[CATALOG] scanning ${url}`);

    let html: string;
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'pt-BR,pt;q=0.9',
        },
        redirect: 'follow',
      });
      if (!res.ok) {
        throw new Error(`${url} retornou ${res.status}`);
      }
      html = await res.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CATALOG] fetch falhou p/ ${url}:`, msg);
      return [];
    }

    const entries = this.parseCatalog(html, animeSlug);
    console.error(
      `[CATALOG] ${animeSlug}: ${entries.length} episódios encontrados (${new Set(entries.map((e) => e.season)).size} temporadas)`,
    );
    return entries;
  }
  /**
   * Escaneia todos os animes FINALIZADO/EM_LANCAMENTO.
   * Enfileira SCAN_CATALOG para cada anime (dedupeKey previne duplicação).
   * Pós-split: não usa episodeCount como critério de skip — o count pode estar
   * desatualizado (426 animes com overcount). dedupeKey garante idempotência.
   */
  async scanAll(force = false): Promise<{ scanned: number; enqueued: number }> {
    const animes = await this.prisma.anime.findMany({
      where: {
        status: { in: ['FINALIZADO', 'LANCAMENTO'] },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        episodeCount: true,
        _count: {
          select: { episodes: true },
        },
      },
    });

    let scanned = 0;
    let enqueued = 0;

    for (const anime of animes) {
      const dbEpisodeCount = anime._count.episodes;
      const expected = anime.episodeCount ?? 0;

      // Sem force: pula apenas se tem episódios e parece completo (count real >= expected)
      // MAS se expected é 0 (episodeCount null), sempre escaneia
      if (!force && expected > 0 && dbEpisodeCount >= expected) {
        continue;
      }
      // Sem force e sem episodeCount: pula se tem pelo menos 1 episódio
      if (!force && expected === 0 && dbEpisodeCount > 0) {
        continue;
      }

      scanned++;
      await this.jobs.enqueue({
        type: JOB_TYPE.SCAN_CATALOG,
        dedupeKey: `scan-catalog:${anime.id}`,
        payload: { animeId: anime.id, slug: anime.slug },
        priority: PRIORITY.SCAN_CATALOG,
      });
      enqueued++;
    }

    console.error(
      `[CATALOG] scanAll(force=${force}): ${scanned} animes com gap, ${enqueued} jobs enfileirados`,
    );
    return { scanned, enqueued };
  }

  /**
   * Processa um job SCAN_CATALOG: escaneia o anime, compara com o DB e enfileira
   * EXTRACT_EPISODE para episódios faltantes. Catalog split-aware: S1 fica no
   * anime original; S2+ são defendidas em animes-irmãos (`<slug>-<n>`), que
   * são criados (Anime row) sob demanda. Episódios sempre season=1 no destino.
   *
   * Detecção de sibling: se o slug termina em `-<n>` (ex: "kaguya-...-2"),
   * processa apenas a temporada N do catálogo. Se for slug base, processa
   * todas as temporadas (criando siblings conforme necessário).
   */
  async processScanCatalog(
    animeId: string,
    slug: string,
  ): Promise<{ found: number; missing: number }> {
    const entries = await this.scanAnime(slug);
    if (entries.length === 0) return { found: 0, missing: 0 };

    // Detecta se este anime é um sibling (slug termina em -<n>)
    const siblingMatch = slug.match(/-(\d+)$/);
    const siblingSeason = siblingMatch ? parseInt(siblingMatch[1]!, 10) : null;

    const seasonsMap = new Map<number, typeof entries>();
    for (const e of entries) {
      const arr = seasonsMap.get(e.season) ?? [];
      arr.push(e);
      seasonsMap.set(e.season, arr);
    }

    const baseAnime = await this.prisma.anime.findUnique({
      where: { id: animeId },
      select: {
        id: true,
        slug: true,
        title: true,
        synopsis: true,
        coverImage: true,
        bannerImage: true,
        ageRating: true,
        status: true,
        audio: true,
        format: true,
        year: true,
        season: true,
        studios: true,
        themes: true,
        alternativeTitles: true,
        published: true,
      },
    });
    if (!baseAnime) return { found: 0, missing: 0 };

    let missing = 0;

    // Se sibling, processa apenas a sua temporada
    const seasonsToProcess = siblingSeason
      ? [siblingSeason]
      : [...seasonsMap.keys()];

    for (const seasonNum of seasonsToProcess) {
      const seasonEntries = seasonsMap.get(seasonNum);
      if (!seasonEntries || seasonEntries.length === 0) continue;

      // Target anime: S1 → original; S2+ → slug-<n> sibling
      let targetId: string;
      let targetSlug: string;
      if (seasonNum === 1 && !siblingSeason) {
        targetId = animeId;
        targetSlug = slug;
      } else {
        const baseSlugForSibling = siblingSeason
          ? slug.replace(/-\d+$/, '')
          : slug;
        const siblingSlug = `${baseSlugForSibling}-${seasonNum}`;
        const existing = await this.prisma.anime.findUnique({
          where: { slug: siblingSlug },
          select: { id: true },
        });
        if (existing) {
          targetId = existing.id;
        } else if (siblingSeason) {
          // Já é o sibling correto
          targetId = animeId;
          targetSlug = siblingSlug;
          const existingEps = await this.prisma.episode.findMany({
            where: { animeId: targetId },
            select: { number: true },
          });
          const haveSet = new Set(existingEps.map((e) => e.number));
          for (const entry of seasonEntries) {
            if (haveSet.has(entry.episode)) continue;
            missing++;
            await this.jobs.enqueue({
              type: JOB_TYPE.EXTRACT_EPISODE,
              dedupeKey: `extract:${targetId}:1:${entry.episode}`,
              payload: {
                animeId: targetId,
                slug: targetSlug,
                episodeNumber: entry.episode,
                season: 1,
                episodeUrl: entry.url,
              },
              priority: PRIORITY.EXTRACT,
            });
          }
          continue;
        } else {
          const created = await this.prisma.anime.create({
            data: {
              slug: siblingSlug,
              title: `${baseAnime.title} ${seasonNum}`,
              synopsis: baseAnime.synopsis,
              coverImage: baseAnime.coverImage,
              bannerImage: baseAnime.bannerImage,
              rating: 0,
              ageRating: baseAnime.ageRating,
              status: baseAnime.status,
              audio: baseAnime.audio,
              format: baseAnime.format,
              year: baseAnime.year,
              season: baseAnime.season,
              studios: baseAnime.studios,
              themes: baseAnime.themes,
              alternativeTitles: baseAnime.alternativeTitles,
              published: baseAnime.published,
              episodeCount: 0,
            },
          });
          targetId = created.id;
        }
        targetSlug = siblingSlug;
      }

      const existing = await this.prisma.episode.findMany({
        where: { animeId: targetId },
        select: { number: true },
      });
      const haveSet = new Set(existing.map((e) => e.number));

      for (const entry of seasonEntries) {
        if (haveSet.has(entry.episode)) continue;
        missing++;
        await this.jobs.enqueue({
          type: JOB_TYPE.EXTRACT_EPISODE,
          dedupeKey: `extract:${targetId}:1:${entry.episode}`,
          payload: {
            animeId: targetId,
            slug: targetSlug,
            episodeNumber: entry.episode,
            season: 1,
            episodeUrl: entry.url,
          },
          priority: PRIORITY.EXTRACT,
        });
      }
    }

    console.error(
      `[CATALOG] ${slug}: ${entries.length} encontrados, ${missing} faltantes enfileirados`,
    );
    return { found: entries.length, missing };
  }

  /**
   * Parseia o HTML da página de catálogo do meusanimes.
   *
   * Estrutura esperada:
   * - div.numerando contém "S - E" (temporada - episódio)
   * - o link do episódio (`a href`) traz a URL REAL publicada — usada como
   *   candidata de extração. Para TV é /e/<slug>-<season>-episodio-<n>/;
   *   para filmes/singles é /e/<slug>/ (sem sufixo).
   */
  private parseCatalog(html: string, _slug: string): CatalogEntry[] {
    const entries: CatalogEntry[] = [];
    const seen = new Set<string>();

    const entryRe =
      /<div\s+class=['"]numerando['"]>\s*(\d+)\s*-\s*(\d+)\s*<\/div>\s*<div\s+class=['"]episodiotitle['"]>\s*<a\s+href=['"]([^'"]+)['"]>/gi;
    let match: RegExpExecArray | null;
    while ((match = entryRe.exec(html)) !== null) {
      const season = parseInt(match[1] ?? '0', 10);
      const episode = parseInt(match[2] ?? '0', 10);
      const url = (match[3] ?? '').trim();
      if (Number.isFinite(season) && Number.isFinite(episode) && url) {
        const key = `${season}-${episode}`;
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({ season, episode, url });
        }
      }
    }

    entries.sort((a, b) => {
      const cmp = a.season - b.season;
      return cmp !== 0 ? cmp : a.episode - b.episode;
    });

    return entries;
  }
}
