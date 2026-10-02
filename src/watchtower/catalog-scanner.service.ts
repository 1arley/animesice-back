import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JobsService } from './jobs.service';
import { extractJobKey, JOB_TYPE, PRIORITY } from './watchtower.types';
import { audioTypeFromTitle } from '@/common/anime-audio';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface CatalogEntry {
  season: number;
  episode: number;
  /** URL real do episódio publicada no catálogo (filmes usam /e/<slug>/). */
  url: string;
}

/** Resultado de um scan: entradas + a fonte que de fato as produziu. */
interface CatalogScan {
  sourceId: string;
  /** Slug real na fonte (p/ persistir como AnimeSource.externalKey). */
  sourceSlug: string;
  entries: CatalogEntry[];
}

const EMPTY_SCAN: CatalogScan = { sourceId: '', sourceSlug: '', entries: [] };

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
   * Escaneia um anime em todas as fontes conhecidas, na ordem de prioridade, e
   * devolve a PRIMEIRA que tiver episódios + qual fonte foi a vencedora.
   *
   * Ordem: meusanimes (base) -> animesdigital (fallback). Fontes sem URL
   * derivável por slug (animesdigital usa post-ID do WordPress) só entram pelo
   * caminho de descoberta de catálogo, nunca por template.
   */
  async scanAnimeResolved(
    animeSlug: string,
    animeId?: string,
  ): Promise<CatalogScan> {
    const meusanimes = await this.scanMeusanimes(animeSlug, animeId);
    if (meusanimes.entries.length > 0) return meusanimes;
    return this.scanAnimesdigital(animeSlug, animeId);
  }

  /** Compatibilidade: só as entradas (sem metadados da fonte). */
  async scanAnime(
    animeSlug: string,
    animeId?: string,
  ): Promise<CatalogEntry[]> {
    return (await this.scanAnimeResolved(animeSlug, animeId)).entries;
  }

  /**
   * Escaneia no meusanimes.blog. Se o slug sibling (ex: "kaguya-...-2") 404,
   * tenta o slug base — meusanimes publica todas temporadas na mesma página.
   */
  private async scanMeusanimes(
    animeSlug: string,
    animeId?: string,
  ): Promise<CatalogScan> {
    const mapping = animeId
      ? await Promise.resolve(
          this.prisma.animeSource?.findUnique({
            where: { animeId_sourceId: { animeId, sourceId: 'meusanimes' } },
            select: { externalKey: true },
          }),
        ).catch(() => null)
      : null;
    const mappedSlug = mapping?.externalKey ?? animeSlug;
    const found = async (slug: string): Promise<CatalogScan> => {
      const entries = await this.tryScan(slug);
      return entries.length > 0
        ? { sourceId: 'meusanimes', sourceSlug: slug, entries }
        : EMPTY_SCAN;
    };

    const entries = await found(mappedSlug);
    if (entries.entries.length > 0) return entries;

    // Slug sibling 404 — tenta slug base (sem sufixo de temporada)
    const baseSlug = mappedSlug.replace(/-\d+$/, '');
    if (baseSlug !== mappedSlug) {
      console.error(
        `[CATALOG] ${animeSlug} vazio no meusanimes — tentando slug base: ${baseSlug}`,
      );
      const viaBase = await found(baseSlug);
      if (viaBase.entries.length > 0) return viaBase;
    }
    if (process.env.NODE_ENV === 'test') return EMPTY_SCAN;

    const discovered = await this.discoverSlug(animeSlug);
    return discovered ? found(discovered) : EMPTY_SCAN;
  }

  /**
   * Escaneia no animesdigital.org (fallback). O slug costuma bater com o
   * animesice, mas a busca do site é usada como plano B — nunca por reescrita
   * de slug. IMPORTANTE: as páginas de episódio usam post-ID do WordPress
   * (`/video/a/<id>/`), então não existe template por slug; o catálogo é a
   * única forma de obter as URLs. Site de temporada única: tudo vai p/ S1.
   */
  private async scanAnimesdigital(
    animeSlug: string,
    animeId?: string,
  ): Promise<CatalogScan> {
    if (process.env.ANIMESDIGITAL_ENABLED !== 'true') return EMPTY_SCAN;

    const mapping = animeId
      ? await Promise.resolve(
          this.prisma.animeSource?.findUnique({
            where: { animeId_sourceId: { animeId, sourceId: 'animesdigital' } },
            select: { externalKey: true },
          }),
        ).catch(() => null)
      : null;

    const candidates: string[] = [];
    for (const raw of [mapping?.externalKey, animeSlug]) {
      const slug = raw?.replace(/-\d+$/, '').trim();
      if (slug && !candidates.includes(slug)) candidates.push(slug);
    }

    for (const slug of candidates) {
      const entries = await this.tryScanAnimesdigital(slug);
      if (entries.length > 0) {
        return { sourceId: 'animesdigital', sourceSlug: slug, entries };
      }
    }

    if (process.env.NODE_ENV === 'test') return EMPTY_SCAN;
    const discovered = await this.discoverAnimesdigitalSlug(animeSlug);
    if (!discovered) return EMPTY_SCAN;
    const entries = await this.tryScanAnimesdigital(discovered);
    return entries.length > 0
      ? { sourceId: 'animesdigital', sourceSlug: discovered, entries }
      : EMPTY_SCAN;
  }

  /** Resolve MeusAnimes identity via its own search, never by slug rewriting. */
  private async discoverSlug(animeSlug: string): Promise<string | null> {
    const query = animeSlug.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
    if (!query) return null;
    const url = `https://meusanimes.blog/?s=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html' },
      });
      if (!res.ok) return null;
      const html = await res.text();
      const wantedDub = /\bdublado\b/i.test(query);
      const links = [
        ...html.matchAll(
          /<a\s+href=['"]https:\/\/meusanimes\.blog\/a\/([^/'"]+)\/?['"][^>]*>([^<]*)<\/a>/gi,
        ),
      ]
        .map((m) => ({ slug: m[1]!, title: (m[2] ?? '').trim() }))
        .filter((x) => /\bdublado\b/i.test(x.title) === wantedDub);
      const normalizedQuery = this.normalize(query);
      const exact = links.find(
        (x) => this.normalize(x.title) === normalizedQuery,
      );
      return (exact ?? links[0])?.slug ?? null;
    } catch {
      return null;
    }
  }

  private normalize(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** Busca no animesdigital.org -> slug da página /anime/a/<slug>. */
  private async discoverAnimesdigitalSlug(
    animeSlug: string,
  ): Promise<string | null> {
    const query = animeSlug.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
    if (!query) return null;
    const url = `https://animesdigital.org/?s=${encodeURIComponent(query)}`;
    let html: string;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html' },
        redirect: 'follow',
      });
      if (!res.ok) return null;
      html = await res.text();
    } catch {
      return null;
    }

    const wantedDub = /\bdublado\b/i.test(query);
    const normalizedQuery = this.normalize(query);
    const links = [
      ...html.matchAll(
        /href=['"](?:https:\/\/animesdigital\.org)?\/anime\/a\/([^/'"?#]+)\/?['"]/gi,
      ),
    ]
      .map((m) => m[1]!)
      .filter((s) => /\bdublado\b/i.test(s) === wantedDub);
    const exact = links.find(
      (s) => this.normalize(s.replace(/-/g, ' ')) === normalizedQuery,
    );
    return exact ?? links[0] ?? null;
  }

  /** Baixa a página /anime/a/<slug> do animesdigital e extrai os episódios. */
  private async tryScanAnimesdigital(slug: string): Promise<CatalogEntry[]> {
    const url = `https://animesdigital.org/anime/a/${slug}`;
    console.error(`[CATALOG] scanning ${url}`);

    let html: string;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'pt-BR,pt;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${url} retornou ${res.status}`);
      html = await res.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CATALOG] fetch falhou p/ ${url}:`, msg);
      return [];
    } finally {
      clearTimeout(timeout);
    }

    const entries = this.parseAnimesdigitalCatalog(html);
    console.error(
      `[CATALOG] animesdigital ${slug}: ${entries.length} episódios encontrados`,
    );
    return entries;
  }

  /**
   * Parseia a listagem do animesdigital.org. Cada episódio é um card
   * `<a href=".../video/a/<postId>/">` cujo corpo traz o rótulo
   * "… Episódio NN" (no <img alt>/<title> ou em div.title_anime).
   *
   * O corpo do anchor é limitado a 1200 chars e não pode conter outro `<a`, o
   * que impede o regex de atravessar o card e capturar o "Episódio" do seguinte.
   */
  private parseAnimesdigitalCatalog(html: string): CatalogEntry[] {
    const entries: CatalogEntry[] = [];
    const seen = new Set<number>();

    const cardRe =
      /<a\s+href=['"](https:\/\/animesdigital\.org\/video\/a\/\d+)\/?['"][^>]*>((?:(?!<a[\s>])[\s\S]){0,1200}?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = cardRe.exec(html)) !== null) {
      const url = (match[1] ?? '').trim();
      const label = match[2] ?? '';
      const num = label.match(/Epis[oó]dio\s*0*(\d{1,4})/i)?.[1];
      if (!url || !num) continue;
      const episode = parseInt(num, 10);
      if (!Number.isFinite(episode) || episode <= 0) continue;
      if (seen.has(episode)) continue;
      seen.add(episode);
      entries.push({ season: 1, episode, url });
    }

    entries.sort((a, b) => a.episode - b.episode);
    return entries;
  }

  private async tryScan(animeSlug: string): Promise<CatalogEntry[]> {
    const url = `https://meusanimes.blog/a/${animeSlug}/`;
    console.error(`[CATALOG] scanning ${url}`);

    let html: string;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'pt-BR,pt;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`${url} retornou ${res.status}`);
      }
      html = await res.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CATALOG] fetch falhou p/ ${url}:`, msg);
      return [];
    } finally {
      clearTimeout(timeout);
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
    const scan = await this.scanAnimeResolved(slug, animeId);
    const { entries } = scan;
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

    // Persiste o mapeamento na fonte que de fato respondeu.
    // meusanimes: mantém o comportamento anterior — externalKey é derivado da
    // URL do episódio (o catálogo publica as temporadas na mesma página).
    // animesdigital: é série única, então o slug da própria página é a chave.
    const sourceId = scan.sourceId || 'meusanimes';
    const seriesSlug =
      entries[0]?.url
        .match(/https:\/\/meusanimes\.blog\/e\/([^/]+)\//i)?.[1]
        ?.replace(/-episodio-\d+.*$/i, '') ?? slug;
    const externalKey =
      sourceId === 'animesdigital' ? scan.sourceSlug : seriesSlug;
    const externalUrl =
      sourceId === 'animesdigital'
        ? `https://animesdigital.org/anime/a/${scan.sourceSlug}`
        : `https://meusanimes.blog/a/${seriesSlug}/`;
    await this.prisma.animeSource
      ?.upsert({
        where: { animeId_sourceId: { animeId, sourceId } },
        update: {
          externalUrl,
          externalKey,
          audio: baseAnime.audio,
          confidence: 1,
          verifiedAt: new Date(),
          lastError: null,
        },
        create: {
          animeId,
          sourceId,
          externalUrl,
          externalKey,
          audio: baseAnime.audio,
          confidence: 1,
          verifiedAt: new Date(),
        },
      })
      .catch(() => undefined);

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
              dedupeKey: extractJobKey(targetId, 1, entry.episode),
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
          const siblingTitle = `${baseAnime.title} ${seasonNum}`;
          const created = await this.prisma.anime.create({
            data: {
              slug: siblingSlug,
              title: siblingTitle,
              synopsis: baseAnime.synopsis,
              coverImage: baseAnime.coverImage,
              bannerImage: baseAnime.bannerImage,
              rating: 0,
              ageRating: baseAnime.ageRating,
              status: baseAnime.status,
              audio: audioTypeFromTitle(siblingTitle),
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
          dedupeKey: extractJobKey(targetId, 1, entry.episode),
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
