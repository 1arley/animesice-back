import { NotFoundException } from '@nestjs/common';
import { GenreService } from '@/genre/genre.service';

function makePrisma() {
  const genre = {
    findMany: jest.fn(async () => []) as jest.Mock,
    findUnique: jest.fn(async () => null) as jest.Mock,
  };
  const anime = {
    findMany: jest.fn(async () => []) as jest.Mock,
    count: jest.fn(async () => 0) as jest.Mock,
  };
  return {
    genre,
    anime,
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('GenreService', () => {
  function build() {
    const prisma = makePrisma();
    const svc = new GenreService(prisma as any);
    return { svc, prisma };
  }

  describe('findAll', () => {
    it('deve listar todos os gêneros ordenados por nome ascendente', async () => {
      const { svc, prisma } = build();
      const genres = [
        { id: 'g1', name: 'Ação', slug: 'acao', _count: { animes: 5 } },
        { id: 'g2', name: 'Comédia', slug: 'comedia', _count: { animes: 3 } },
      ];
      prisma.genre.findMany.mockResolvedValue(genres);

      const result = await svc.findAll();

      expect(result).toEqual(genres);
      expect(prisma.genre.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
        include: { _count: { select: { animes: true } } },
      });
    });

    it('deve retornar lista vazia quando não há gêneros', async () => {
      const { svc, prisma } = build();
      prisma.genre.findMany.mockResolvedValue([]);

      const result = await svc.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findBySlug', () => {
    it('deve retornar o gênero quando o slug existe', async () => {
      const { svc, prisma } = build();
      const genre = { id: 'g1', name: 'Ação', slug: 'acao' };
      prisma.genre.findUnique.mockResolvedValue(genre);

      const result = await svc.findBySlug('acao');

      expect(result).toEqual(genre);
      expect(prisma.genre.findUnique).toHaveBeenCalledWith({
        where: { slug: 'acao' },
      });
    });

    it('deve lançar NotFoundException quando o gênero não existe', async () => {
      const { svc } = build();

      await expect(svc.findBySlug('nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAnimesBySlug', () => {
    it('deve retornar animes paginados de um gênero', async () => {
      const { svc, prisma } = build();
      const genre = { id: 'g1', name: 'Ação' };
      const animes = [
        { id: 'a1', title: 'Anime 1', genres: [{ id: 'g1', slug: 'acao' }] },
      ];
      prisma.genre.findUnique.mockResolvedValue(genre);
      prisma.anime.findMany.mockResolvedValue(animes);
      prisma.anime.count.mockResolvedValue(1);

      const result = await svc.findAnimesBySlug('acao', '1', '10');

      expect(result).toEqual({
        genre: { id: 'g1', name: 'Ação', slug: 'acao' },
        data: animes,
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      expect(prisma.genre.findUnique).toHaveBeenCalledWith({
        where: { slug: 'acao' },
        select: { id: true, name: true },
      });
      expect(prisma.anime.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { published: true, genres: { some: { slug: 'acao' } } },
          orderBy: { rating: 'desc' },
        }),
      );
    });

    it('deve lançar NotFoundException quando o gênero não existe', async () => {
      const { svc } = build();

      await expect(
        svc.findAnimesBySlug('nao-existe', '1', '10'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve usar valores padrão para page e limit', async () => {
      const { svc, prisma } = build();
      prisma.genre.findUnique.mockResolvedValue({ id: 'g1', name: 'Ação' });
      prisma.anime.findMany.mockResolvedValue([]);
      prisma.anime.count.mockResolvedValue(0);

      await svc.findAnimesBySlug('acao', undefined, undefined);

      expect(prisma.anime.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('deve retornar meta com totalPages = 0 quando não há animes', async () => {
      const { svc, prisma } = build();
      prisma.genre.findUnique.mockResolvedValue({ id: 'g1', name: 'Ação' });
      prisma.anime.findMany.mockResolvedValue([]);
      prisma.anime.count.mockResolvedValue(0);

      const result = await svc.findAnimesBySlug('acao', '1', '10');

      expect(result.meta.totalPages).toBe(0);
    });
  });
});
