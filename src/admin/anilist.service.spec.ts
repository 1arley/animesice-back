import { NotFoundException } from '@nestjs/common';
import { AniListService, AniListMedia } from '@/admin/anilist.service';

describe('AniListService', () => {
  let service: AniListService;
  let fetchMock: jest.SpyInstance;

  const media: AniListMedia = {
    id: 123,
    title: { romaji: 'Frieren', english: 'Frieren', native: 'フリーレン' },
    description: 'Synopsis',
  };

  function mockFetchResponse(
    status: number,
    jsonBody: unknown,
    ok?: boolean,
  ): void {
    fetchMock.mockResolvedValue({
      status,
      ok: ok ?? status < 400,
      json: jest.fn().mockResolvedValue(jsonBody),
    } as any);
  }

  beforeEach(() => {
    service = new AniListService();
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({} as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('fetchMedia', () => {
    it('retorna a mídia do AniList com sucesso', async () => {
      mockFetchResponse(200, { data: { Media: media } });

      const result = await service.fetchMedia(123);

      expect(result).toEqual(media);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graphql.anilist.co',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        }),
      );
    });

    it('lança NotFoundException quando a API responde HTTP 404', async () => {
      mockFetchResponse(404, {});

      await expect(service.fetchMedia(1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lança NotFoundException quando há erro GraphQL status 404', async () => {
      mockFetchResponse(200, {
        errors: [{ message: 'Not found', status: 404 }],
      });

      await expect(service.fetchMedia(1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lança NotFoundException quando responde !ok e contém erros', async () => {
      mockFetchResponse(500, { errors: [{ message: 'boom' }] }, false);

      await expect(service.fetchMedia(1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('retorna data mesmo com warnings quando ok=true e data existe', async () => {
      mockFetchResponse(200, {
        errors: [{ message: 'partial' }],
        data: { Media: media },
      });

      const result = await service.fetchMedia(1);

      expect(result).toEqual(media);
    });

    it('lança NotFoundException quando json.data é vazio', async () => {
      mockFetchResponse(200, {});

      await expect(service.fetchMedia(1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lança NotFoundException quando o fetch falha', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(service.fetchMedia(1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('inclui o ID no body da requisição', async () => {
      mockFetchResponse(200, { data: { Media: media } });

      await service.fetchMedia(42);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.variables.id).toBe(42);
    });
  });

  describe('searchMedia', () => {
    it('retorna o primeiro resultado da busca', async () => {
      mockFetchResponse(200, { data: { Page: { media: [media] } } });

      const result = await service.searchMedia('frieren');

      expect(result).toEqual(media);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.variables).toEqual({ search: 'frieren', perPage: 1 });
    });

    it('lança NotFoundException quando não encontra resultados', async () => {
      mockFetchResponse(200, { data: { Page: { media: [] } } });

      await expect(service.searchMedia('inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
