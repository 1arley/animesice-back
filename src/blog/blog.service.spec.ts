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

  it('findPublishedBySlug retorna post publicado', async () => {
    prisma.blogPost.findFirst.mockResolvedValue({ id: 'p1', slug: 'artigo' });
    const result = await service.findPublishedBySlug('artigo');
    expect(result.id).toBe('p1');
  });

  it('findById retorna post e lança 404 se não existir', async () => {
    prisma.blogPost.findUnique.mockResolvedValue({ id: 'p1' });
    expect(await service.findById('p1')).toEqual({ id: 'p1' });

    prisma.blogPost.findUnique.mockResolvedValue(null);
    await expect(service.findById('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update sanitiza conteúdo e preserva publishedAt existente', async () => {
    prisma.blogPost.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.blogPost.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'p1', ...data }),
    );

    const result = await service.update('p1', {
      title: ' Novo ',
      content: '<script>x</script><p>Ok</p>',
    });

    expect(result.title).toBe('Novo');
    expect(result.content).toBe('<p>Ok</p>');
    expect(prisma.blogPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' } }),
    );
  });

  it('update lança 404 se post não existe', async () => {
    prisma.blogPost.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { title: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.blogPost.update).not.toHaveBeenCalled();
  });

  it('update converte colisão de slug em ConflictException', async () => {
    prisma.blogPost.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.blogPost.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: '7.9.1',
        meta: { target: ['slug'] },
      }),
    );

    await expect(
      service.update('p1', { slug: 'duplicado' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('remove exclui post publicado', async () => {
    prisma.blogPost.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.blogPost.delete.mockResolvedValue({});
    const result = await service.remove('p1');
    expect(prisma.blogPost.delete).toHaveBeenCalledWith({
      where: { id: 'p1' },
    });
    expect(result).toEqual({ message: 'Artigo excluído.' });
  });

  it('remove lança 404 se post não existe', async () => {
    prisma.blogPost.findUnique.mockResolvedValue(null);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('create respeita publishedAt explícito', async () => {
    prisma.blogPost.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'p1', ...data }),
    );
    const explicit = new Date('2025-01-01T00:00:00Z');
    const result = await service.create({
      title: 'T',
      slug: 't',
      description: 'Descrição',
      category: 'Guias',
      content: '<p>c</p>',
      published: true,
      publishedAt: explicit as any,
    });
    expect(result.publishedAt).toEqual(explicit);
  });

  it('create propaga erro não relacionado a slug', async () => {
    prisma.blogPost.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.create({
        title: 'T',
        slug: 't',
        description: 'Descrição',
        category: 'Guias',
        content: '<p>c</p>',
        published: false,
      }),
    ).rejects.toThrow('db down');
  });

  it('list sem filtro published usa {} quando canManage e published null', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);
    await service.list(0, 0, { canManage: true, published: undefined });
    expect(prisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});
