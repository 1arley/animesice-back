import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BlogService } from '@/blog/blog.service';

describe('BlogService', () => {
  const prisma = {
    blogPost: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  let service: BlogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlogService(prisma as never);
  });

  it('sempre filtra publicados para visitantes', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);

    await service.list(1, 24, { published: false, canManage: false });

    expect(prisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { published: true } }),
    );
  });

  it('permite que admins listem rascunhos e retorna paginação compatível', async () => {
    prisma.$transaction.mockResolvedValue([[{ id: 'draft' }], 1]);

    const result = await service.list(1, 500, {
      published: false,
      canManage: true,
    });

    expect(prisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { published: false }, take: 100 }),
    );
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    });
  });

  it('sanitiza HTML e define a data ao publicar', async () => {
    prisma.blogPost.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'post-1', ...data }),
    );

    const result = await service.create({
      title: ' Artigo ',
      slug: 'artigo',
      description: ' Descrição ',
      category: ' Guias ',
      content:
        '<p onclick="alert(1)">Seguro</p><script>alert(1)</script><a href="javascript:alert(1)">link</a>',
      published: true,
      publishedAt: null,
    });

    expect(result.content).toBe('<p>Seguro</p><a>link</a>');
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(result.title).toBe('Artigo');
  });

  it('converte colisão de slug em conflito legível', async () => {
    prisma.blogPost.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: '7.9.1',
        meta: { target: ['slug'] },
      }),
    );

    await expect(
      service.create({
        title: 'Artigo',
        slug: 'artigo',
        description: 'Descrição',
        category: 'Guias',
        content: '<p>Conteúdo</p>',
        published: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('não expõe rascunho pela rota pública de slug', async () => {
    prisma.blogPost.findFirst.mockResolvedValue(null);

    await expect(
      service.findPublishedBySlug('rascunho'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.blogPost.findFirst).toHaveBeenCalledWith({
      where: { slug: 'rascunho', published: true },
    });
  });
});
