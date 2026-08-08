import { Injectable, NotFoundException } from '@nestjs/common';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

export interface AniListTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

export interface AniListCoverImage {
  large?: string | null;
  extraLarge?: string | null;
}

export interface AniListMedia {
  id: number;
  title: AniListTitle;
  description?: string | null;
  coverImage?: AniListCoverImage;
  bannerImage?: string | null;
  averageScore?: number | null;
  status?: string | null;
  genres?: (string | null)[] | null;
  isAdult?: boolean | null;
  season?: string | null;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
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
  studios?: {
    nodes?: Array<{ name: string; isAnimationStudio?: boolean }> | null;
  } | null;
  source?: string | null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; status?: number }>;
}

@Injectable()
export class AniListService {
  // Media por id ----------------------------------------------------------
  async fetchMedia(id: number): Promise<AniListMedia> {
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
          source
        }
      }`;

    const body = JSON.stringify({ query, variables: { id } });
    const media = await this.request<{ Media: AniListMedia }>(body);
    return media.Media;
  }

  // Busca por search (Page) ----------------------------------------------
  async searchMedia(search: string): Promise<AniListMedia> {
    const query = `
      query ($search: String, $perPage: Int) {
        Page(perPage: $perPage) {
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
            source
          }
        }
      }`;

    const body = JSON.stringify({ query, variables: { search, perPage: 1 } });
    const res = await this.request<{ Page: { media: AniListMedia[] } }>(body);
    const first = res.Page.media?.[0];
    if (!first) {
      throw new NotFoundException(
        `Nenhum anime encontrado no AniList para "${search}".`,
      );
    }
    return first;
  }

  // Helper fetch global --------------------------------------------------
  private async request<T>(body: string): Promise<T> {
    let res: Response;
    try {
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
    } catch (err) {
      throw new NotFoundException(
        `Falha ao contatar a API do AniList: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (res.status === 404) {
      throw new NotFoundException('Anime não encontrado no AniList (404).');
    }

    const json = (await res.json()) as GraphQLResponse<T>;

    if (json.errors?.length) {
      const msg = json.errors[0]?.message ?? 'Erro desconhecido';
      const status = json.errors[0]?.status;
      if (status === 404) {
        throw new NotFoundException(`AniList: ${msg}`);
      }
      if (!res.ok) {
        throw new NotFoundException(`AniList: ${msg}`);
      }
    }

    if (!json.data) {
      throw new NotFoundException('Resposta vazia do AniList.');
    }
    return json.data;
  }
}
