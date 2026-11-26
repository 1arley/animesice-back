import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AniListClient } from './anilist-client.service';

const CURSOR_KEY = 'internal.watchtower.anime-cover-repair.cursor';
const LEASE_KEY = 'internal.watchtower.anime-cover-repair.lease';
const BATCH_SIZE = 30;
const LEASE_MS = 20 * 60_000;
const LEASE_QUERY_TIMEOUT_MS = 10_000;
const MAL_ENDPOINT = 'https://api.myanimelist.net/v2';
const JIKAN_ENDPOINT = 'https://api.jikan.moe/v4';
const MAL_INTERVAL_MS = 1100;

interface AnimeToRepair {
  id: string;
  slug: string;
  coverImage: string | null;
  title: string;
  japaneseTitle: string | null;
  alternativeTitles: string[];
  year: number | null;
  anilistId: number | null;
  malId: number | null;
}

interface MalHit {
  id: number;
  titles: string[];
  year: number | null;
  image: string | null;
}

interface MalOfficialHit {
  id: number;
  title?: string;
  main_picture?: { large?: string; medium?: string } | null;
  alternative_titles?: {
    en?: string | null;
    ja?: string | null;
    synonyms?: string[] | null;
  } | null;
  start_date?: string | null;
}

interface JikanHit {
  mal_id: number;
  title?: string | null;
  title_english?: string | null;
  title_japanese?: string | null;
  title_synonyms?: string[] | null;
  year?: number | null;
  aired?: { from?: string | null } | null;
  images?: {
    webp?: { large_image_url?: string | null; image_url?: string | null };
    jpg?: { large_image_url?: string | null; image_url?: string | null };
  } | null;
}

class LeaseLostError extends Error {
  constructor() {
    super('Lease de reparo de capas expirou.');
  }
}

class LeaseQueryTimeoutError extends Error {
  constructor(action: string) {
    super(`Timeout ao ${action} lease de capas.`);
  }
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function mediaYear(value?: string | null): number | null {
  const year = Number(value?.slice(0, 4));
  return Number.isInteger(year) && year >= 1900 ? year : null;
}

function compatibleYear(
  localYear: number | null,
  remoteYear: number | null,
): boolean {
  return localYear === null || remoteYear === localYear;
}

function imageUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

@Injectable()
export class AnimeCoverRepair {
  private running = false;
  private lastMalCall = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly anilist: AniListClient,
  ) {}

  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let lease: string | null = null;
    try {
      lease = await this.acquireLease();
      if (!lease) return 0;
      const row = await this.withTimeout(
        this.prisma.siteSetting.findUnique({
          where: { key: CURSOR_KEY },
          select: { value: true },
        }),
        'ler cursor',
      );
      let cursor = row?.value ?? '';
      let animes = await this.nextBatch(cursor);
      if (!animes.length && cursor) {
        cursor = '';
        animes = await this.nextBatch(cursor);
      }
      if (!animes.length) return 0;

      let repaired = 0;
      let unresolved = 0;
      let failed = 0;
      for (const anime of animes) {
        const renewedLease = await this.renewLease(lease);
        if (!renewedLease) throw new Error('Lease de reparo de capas expirou.');
        lease = renewedLease;
        let cover: string | null;
        try {
          const result = await this.resolveCoverWithLease(anime, lease);
          cover = result.cover;
          lease = result.lease;
        } catch (error) {
          if (error instanceof LeaseLostError) throw error;
          failed++;
          console.error(
            '[COVER-REPAIR] falha em',
            anime.slug,
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }
        const verifiedLease = await this.renewLease(lease);
        if (!verifiedLease)
          throw new Error('Lease de reparo de capas expirou.');
        lease = verifiedLease;
        if (!cover) {
          unresolved++;
          continue;
        }
        try {
          const result = await this.withTimeout(
            this.prisma.anime.updateMany({
              where: { id: anime.id, coverImage: anime.coverImage },
              data: { coverImage: cover },
            }),
            'gravar capa',
          );
          repaired += result.count;
        } catch (error) {
          failed++;
          console.error(
            '[COVER-REPAIR] falha em',
            anime.slug,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      const verifiedLease = await this.renewLease(lease);
      if (!verifiedLease) throw new Error('Lease de reparo de capas expirou.');
      lease = verifiedLease;
      const nextCursor = animes[animes.length - 1]!.id;
      if (!(await this.advanceCursor(lease, nextCursor)))
        throw new LeaseLostError();
      console.info(
        `[COVER-REPAIR] ${repaired}/${animes.length} reparadas, ${unresolved} não resolvidas, ${failed} erros; cursor=${nextCursor}`,
      );
      return repaired;
    } finally {
      if (lease) await this.releaseLease(lease);
      this.running = false;
    }
  }

  private async nextBatch(cursor: string): Promise<AnimeToRepair[]> {
    return this.withTimeout(
      this.prisma.$queryRaw<AnimeToRepair[]>`
      SELECT "id", "slug", "title", "coverImage", "japaneseTitle",
             "alternativeTitles", "year", "anilistId", "malId"
      FROM "Anime"
      WHERE ("coverImage" IS NULL OR regexp_replace("coverImage", '[[:space:]]', '', 'g') = '')
        AND "id" > ${cursor}
      ORDER BY "id" ASC
      LIMIT ${BATCH_SIZE}
    `,
      'consultar catálogo',
    );
  }

  private async acquireLease(): Promise<string | null> {
    const owner = randomUUID();
    const query = this.prisma.$queryRaw<Array<{ value: string }>>`
      INSERT INTO "SiteSetting" ("key", "value")
      VALUES (
        ${LEASE_KEY},
        ((EXTRACT(EPOCH FROM clock_timestamp()) * 1000 + ${LEASE_MS})::BIGINT)::TEXT || '|' || ${owner}
      )
      ON CONFLICT ("key") DO UPDATE
      SET "value" = EXCLUDED."value"
      WHERE CASE
        WHEN split_part(COALESCE("SiteSetting"."value", ''), '|', 1) ~ '^[0-9]{1,15}$'
        THEN split_part("SiteSetting"."value", '|', 1)::BIGINT <
          (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
        ELSE TRUE
      END
      RETURNING "value"
    `;
    try {
      const acquired = await this.withTimeout(query, 'adquirir');
      return acquired[0]?.value ?? null;
    } catch (error) {
      if (error instanceof LeaseQueryTimeoutError) {
        void query
          .then((acquired) => {
            const lateLease = acquired[0]?.value;
            return lateLease ? this.releaseLease(lateLease) : undefined;
          })
          .catch((lateError: unknown) =>
            this.logProviderFailure(
              'banco ao limpar lease atrasado',
              lateError,
            ),
          );
      }
      throw error;
    }
  }

  private async renewLease(lease: string): Promise<string | null> {
    const owner = lease.split('|')[1];
    if (!owner) return null;
    const query = this.prisma.$queryRaw<Array<{ value: string }>>`
      UPDATE "SiteSetting"
      SET "value" =
        ((EXTRACT(EPOCH FROM clock_timestamp()) * 1000 + ${LEASE_MS})::BIGINT)::TEXT || '|' || ${owner}
      WHERE "key" = ${LEASE_KEY}
        AND split_part("value", '|', 2) = ${owner}
      RETURNING "value"
    `;
    const renewed = await this.withTimeout(query, 'renovar');
    return renewed[0]?.value ?? null;
  }

  private async releaseLease(lease: string): Promise<void> {
    const owner = lease.split('|')[1];
    if (!owner) return;
    try {
      const query = this.prisma.$executeRaw`
        UPDATE "SiteSetting" SET "value" = NULL
        WHERE "key" = ${LEASE_KEY}
          AND split_part("value", '|', 2) = ${owner}
      `;
      await this.withTimeout(query, 'liberar');
    } catch (error) {
      this.logProviderFailure('banco ao liberar lease', error);
    }
  }

  private async advanceCursor(lease: string, cursor: string): Promise<boolean> {
    const owner = lease.split('|')[1];
    if (!owner) return false;
    const advanced = await this.withTimeout(
      this.prisma.$queryRaw<Array<{ key: string }>>`
        WITH valid_lease AS (
          SELECT "key" FROM "SiteSetting"
          WHERE "key" = ${LEASE_KEY}
            AND split_part("value", '|', 2) = ${owner}
            AND split_part("value", '|', 1) ~ '^[0-9]{1,15}$'
            AND split_part("value", '|', 1)::BIGINT >
              (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
          FOR UPDATE
        )
        INSERT INTO "SiteSetting" ("key", "value")
        SELECT ${CURSOR_KEY}, ${cursor} FROM valid_lease
        ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
        RETURNING "key"
      `,
      'avançar cursor',
    );
    return advanced.length > 0;
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    action: string,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new LeaseQueryTimeoutError(action)),
            LEASE_QUERY_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async resolveCoverWithLease(
    anime: AnimeToRepair,
    lease: string,
  ): Promise<{ cover: string | null; lease: string }> {
    let currentLease = lease;
    let leaseLost = false;
    let renewal: Promise<void> | null = null;
    const heartbeat = setInterval(
      () => {
        if (renewal || leaseLost) return;
        renewal = this.renewLease(currentLease)
          .then((renewed) => {
            if (renewed) currentLease = renewed;
            else leaseLost = true;
          })
          .catch((error: unknown) => {
            this.logProviderFailure('banco ao renovar lease', error);
            if (error instanceof LeaseQueryTimeoutError) leaseLost = true;
          })
          .finally(() => {
            renewal = null;
          });
      },
      Math.floor(LEASE_MS / 3),
    );

    try {
      const cover = await this.resolveCover(anime);
      clearInterval(heartbeat);
      await Promise.resolve(renewal);
      if (leaseLost) throw new LeaseLostError();
      const renewed = await this.renewLease(currentLease);
      if (!renewed) throw new LeaseLostError();
      return { cover, lease: renewed };
    } finally {
      clearInterval(heartbeat);
      await Promise.resolve(renewal);
    }
  }

  private async resolveCover(anime: AnimeToRepair): Promise<string | null> {
    if (anime.anilistId) {
      try {
        const media = await this.anilist.fetchMedia(anime.anilistId);
        const cover = imageUrl(
          media.coverImage?.extraLarge ?? media.coverImage?.large,
        );
        if (cover) return cover;
      } catch (error) {
        // Continue to the other linked provider or a safe title match.
        this.logProviderFailure('AniList', error);
      }
    }

    if (anime.malId) {
      const hit = await this.fetchMalById(anime.malId);
      const cover = imageUrl(hit?.image);
      if (cover) return cover;
    }

    const titles = [
      anime.title,
      anime.japaneseTitle ?? '',
      ...anime.alternativeTitles,
      anime.slug.replace(/-/g, ' '),
    ]
      .map((title) => title.trim())
      .filter(Boolean);
    const query = anime.title || anime.slug.replace(/-/g, ' ');
    const malMatch = await this.searchMal(query, titles, anime.year);
    if (malMatch) return imageUrl(malMatch.image);

    try {
      const media = await this.anilist.searchMediaCandidates(query);
      const matches = media.filter(
        (candidate) =>
          this.titleMatches(
            titles,
            [
              candidate.title.romaji,
              candidate.title.english,
              candidate.title.native,
            ].filter((title): title is string => Boolean(title)),
          ) &&
          compatibleYear(
            anime.year,
            candidate.startDate?.year ?? candidate.seasonYear ?? null,
          ),
      );
      const ids = new Set(matches.map(({ id }) => id));
      if (ids.size === 1) {
        const match = matches.find((candidate) =>
          imageUrl(
            candidate.coverImage?.extraLarge ?? candidate.coverImage?.large,
          ),
        );
        if (match) {
          return imageUrl(
            match.coverImage?.extraLarge ?? match.coverImage?.large,
          );
        }
      }
    } catch (error) {
      // A failed secondary lookup is retried after the cursor wraps around.
      this.logProviderFailure('AniList', error);
    }
    return null;
  }

  private async searchMal(
    query: string,
    localTitles: string[],
    year: number | null,
  ): Promise<MalHit | null> {
    if (process.env.MAL_CLIENT_ID) {
      const url = new URL('/v2/anime', MAL_ENDPOINT);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '10');
      url.searchParams.set(
        'fields',
        'main_picture,alternative_titles,start_date',
      );
      const response = await this.fetchMal(url.toString(), {
        'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID,
      });
      const payload = await this.readJson<{
        data?: Array<{ node?: MalOfficialHit }>;
      }>(response);
      const hits = (Array.isArray(payload?.data) ? payload.data : [])
        .map((entry) => entry?.node)
        .filter((node): node is MalOfficialHit => Boolean(node))
        .map((node) => this.fromOfficial(node))
        .filter((hit): hit is MalHit => Boolean(hit));
      const match = this.uniqueMatch(hits, localTitles, year);
      if (match) return match;
    }

    const url = new URL('/anime', JIKAN_ENDPOINT);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '10');
    const response = await this.fetchMal(url.toString());
    const payload = await this.readJson<{ data?: JikanHit[] }>(response);
    return this.uniqueMatch(
      (Array.isArray(payload?.data) ? payload.data : [])
        .map((hit) => this.fromJikan(hit))
        .filter((hit): hit is MalHit => Boolean(hit)),
      localTitles,
      year,
    );
  }

  private async fetchMalById(id: number): Promise<MalHit | null> {
    if (process.env.MAL_CLIENT_ID) {
      const url = new URL(`/v2/anime/${id}`, MAL_ENDPOINT);
      url.searchParams.set(
        'fields',
        'main_picture,alternative_titles,start_date',
      );
      const response = await this.fetchMal(url.toString(), {
        'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID,
      });
      const hit = await this.readJson<MalOfficialHit>(response);
      const official = hit?.id === id ? this.fromOfficial(hit) : null;
      if (official?.image) return official;
    }

    const response = await this.fetchMal(`${JIKAN_ENDPOINT}/anime/${id}`);
    const hit = await this.readJson<{ data?: JikanHit }>(response);
    return hit?.data?.mal_id === id ? this.fromJikan(hit.data) : null;
  }

  private async fetchMal(
    url: string,
    headers?: Record<string, string>,
  ): Promise<Response | null> {
    const wait = MAL_INTERVAL_MS - (Date.now() - this.lastMalCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastMalCall = Date.now();
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 429 && response.status < 500) {
        if (!response.ok && response.status !== 404) {
          this.logProviderFailure(new URL(url).host, `HTTP ${response.status}`);
        }
        return response;
      }
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds = Number(retryAfter);
      const retryAfterDate = retryAfter ? Date.parse(retryAfter) : NaN;
      const delay = Math.min(
        30_000,
        Number.isFinite(retryAfterSeconds)
          ? Math.max(0, retryAfterSeconds * 1000)
          : Number.isFinite(retryAfterDate)
            ? Math.max(0, retryAfterDate - Date.now())
            : 2000,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const retry = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!retry.ok && retry.status !== 404) {
          this.logProviderFailure(
            new URL(url).host,
            `HTTP ${retry.status} após retry`,
          );
        }
        return retry;
      } catch (error) {
        this.logProviderFailure(new URL(url).host, error);
        return null;
      }
    } catch (error) {
      this.logProviderFailure(new URL(url).host, error);
      return null;
    }
  }

  private async readJson<T>(response: Response | null): Promise<T | null> {
    if (!response?.ok) return null;
    try {
      return (await response.json()) as T;
    } catch (error) {
      this.logProviderFailure(
        response.url ? new URL(response.url).host : 'API de imagens',
        error,
      );
      return null;
    }
  }

  private logProviderFailure(provider: string, error: unknown): void {
    console.warn(
      `[COVER-REPAIR] ${provider}:`,
      error instanceof Error ? error.message : String(error),
    );
  }

  private fromOfficial(hit: MalOfficialHit): MalHit | null {
    if (!Number.isSafeInteger(hit.id) || hit.id <= 0) return null;
    const synonyms = Array.isArray(hit.alternative_titles?.synonyms)
      ? hit.alternative_titles.synonyms
      : [];
    return {
      id: hit.id,
      titles: [
        hit.title,
        hit.alternative_titles?.en ?? '',
        hit.alternative_titles?.ja ?? '',
        ...synonyms,
      ].filter(
        (title): title is string => typeof title === 'string' && !!title,
      ),
      year: mediaYear(hit.start_date),
      image: hit.main_picture?.large ?? hit.main_picture?.medium ?? null,
    };
  }

  private fromJikan(hit: JikanHit): MalHit | null {
    if (!Number.isSafeInteger(hit.mal_id) || hit.mal_id <= 0) return null;
    const synonyms = Array.isArray(hit.title_synonyms)
      ? hit.title_synonyms
      : [];
    return {
      id: hit.mal_id,
      titles: [
        hit.title ?? '',
        hit.title_english ?? '',
        hit.title_japanese ?? '',
        ...synonyms,
      ].filter(
        (title): title is string => typeof title === 'string' && !!title,
      ),
      year: hit.year ?? mediaYear(hit.aired?.from),
      image:
        hit.images?.webp?.large_image_url ??
        hit.images?.jpg?.large_image_url ??
        hit.images?.webp?.image_url ??
        hit.images?.jpg?.image_url ??
        null,
    };
  }

  private titleMatches(localTitles: string[], remoteTitles: string[]): boolean {
    const normalized = new Set(localTitles.map(normalizeTitle).filter(Boolean));
    return remoteTitles.some((title) => normalized.has(normalizeTitle(title)));
  }

  private uniqueMatch(
    hits: MalHit[],
    localTitles: string[],
    year: number | null,
  ): MalHit | null {
    const matches = hits.filter(
      (hit) =>
        imageUrl(hit.image) &&
        Number.isSafeInteger(hit.id) &&
        hit.id > 0 &&
        this.titleMatches(localTitles, hit.titles) &&
        compatibleYear(year, hit.year),
    );
    const ids = new Set(matches.map((hit) => hit.id));
    return ids.size === 1 ? (matches[0] ?? null) : null;
  }
}
