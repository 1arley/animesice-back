/**
 * AniListClient — client GraphQL para airingSchedule, season discovery, busca.
 *
 * Reaproveita padrão do admin/anilist.service.ts (mesmo endpoint, mesmo rate
 * limit de 700ms entre calls). Estendido com:
 *  - airingSchedule(mediaId): episódios previstos + airingAt
 *  - seasonMedia(season, year): anime da temporada (p/ discovery)
 *  - fetchMedia(id): detalhes completos (já existente no admin, replicado p/ desacoplar)
 */
import { Injectable } from '@nestjs/common';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const SLEEP_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AiringEpisode {
  airingAt: number;
  episode: number;
}

export interface AniListMediaSummary {
  id: number;
  title: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
  };
  coverImage?: { large?: string | null; extraLarge?: string | null } | null;
  bannerImage?: string | null;
  description?: string | null;
  averageScore?: number | null;
  status?: string | null;
  genres?: (string | null)[] | null;
  isAdult?: boolean | null;
  season?: string | null;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  studios?: {
    nodes?: Array<{ name: string; isAnimationStudio?: boolean }> | null;
  } | null;
  startDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
  endDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; status?: number }>;
}

@Injectable()
export class AniListClient {
  private lastCall = 0;

  async fetchMedia(id: number): Promise<AniListMediaSummary> {
    const query = `
      query ($id: Int) {
        Media(id: $id) {
          id
          title { romaji english native }
          description
          coverImage { large extraLarge }
          bannerImage
          averageScore
          status
          genres
          isAdult
          season
          seasonYear
          format
          episodes
          startDate { year month day }
          endDate { year month day }
          studios(isMain: true) { nodes { name isAnimationStudio } }
        }
      }`;
    const data = await this.request<{ Media: AniListMediaSummary }>(
      JSON.stringify({ query, variables: { id } }),
    );
    return data.Media;
  }

  /** AiringSchedule: lista episódios previstos com airingAt (unix). */
  async airingSchedule(mediaId: number): Promise<AiringEpisode[]> {
    const query = `
      query ($id: Int, $notYetAired: Boolean) {
        Media(id: $id) {
          airingSchedule(notYetAired: $notYetAired) {
            nodes { airingAt episode }
          }
        }
      }`;
    const data = await this.request<{
      Media: { airingSchedule: { nodes: AiringEpisode[] } };
    }>(
      JSON.stringify({ query, variables: { id: mediaId, notYetAired: false } }),
    );
    return data.Media.airingSchedule.nodes;
  }

  /** Busca media por título (sort: SEARCH_MATCH). */
  async searchMedia(search: string): Promise<AniListMediaSummary | null> {
    const query = `
      query ($search: String) {
        Page(perPage: 1) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english native }
            description
            coverImage { large extraLarge }
            bannerImage
            averageScore
            status
            genres
            isAdult
            season
            seasonYear
            format
            episodes
            startDate { year month day }
            endDate { year month day }
            studios(isMain: true) { nodes { name isAnimationStudio } }
          }
        }
      }`;
    const data = await this.request<{ Page: { media: AniListMediaSummary[] } }>(
      JSON.stringify({ query, variables: { search } }),
    );
    return data.Page.media?.[0] ?? null;
  }

  /** Lista media da temporada (season + year). perPage default 50. */
  async seasonMedia(
    season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL',
    seasonYear: number,
    page = 1,
    perPage = 50,
  ): Promise<{ media: AniListMediaSummary[]; hasNext: boolean }> {
    const query = `
      query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage currentPage }
          media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
            id
            title { romaji english native }
            description
            coverImage { large extraLarge }
            bannerImage
            averageScore
            status
            genres
            isAdult
            season
            seasonYear
            format
            episodes
            startDate { year month day }
            endDate { year month day }
            studios(isMain: true) { nodes { name isAnimationStudio } }
          }
        }
      }`;
    const data = await this.request<{
      Page: {
        pageInfo: { hasNextPage: boolean };
        media: AniListMediaSummary[];
      };
    }>(
      JSON.stringify({
        query,
        variables: { season, year: seasonYear, page, perPage },
      }),
    );
    return { media: data.Page.media, hasNext: data.Page.pageInfo.hasNextPage };
  }

  private async request<T>(body: string): Promise<T> {
    await this.rateLimit();

    let res: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      res = await fetch(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      await sleep(5000);
      return this.request<T>(body);
    }

    const json = (await res.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      throw new Error(
        `AniList: ${json.errors[0]?.message ?? 'erro desconhecido'}`,
      );
    }
    if (!json.data) throw new Error('AniList: resposta vazia');
    return json.data;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < SLEEP_MS) await sleep(SLEEP_MS - elapsed);
    this.lastCall = Date.now();
  }
}
