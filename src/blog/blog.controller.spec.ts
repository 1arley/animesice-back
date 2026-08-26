import { Test, TestingModule } from '@nestjs/testing';
import { BlogController } from '@/blog/blog.controller';
import { BlogService } from '@/blog/blog.service';

describe('BlogController', () => {
  let controller: BlogController;

  const mockBlogService = {
    list: jest.fn(),
    findPublishedBySlug: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const reqWithRole = (role?: string) =>
    ({ user: role ? { role } : undefined }) as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  describe('list', () => {
    it('lista artigos públicos para usuário comum', async () => {
      mockBlogService.list.mockResolvedValue({ posts: [], total: 0 });
      await controller.list(
        reqWithRole('USER'),
        undefined,
        undefined,
        undefined,
      );
      expect(mockBlogService.list).toHaveBeenCalledWith(1, 24, {
        canManage: false,
        published: undefined,
      });
    });

    it('lista incluindo rascunhos para admin', async () => {
      mockBlogService.list.mockResolvedValue({ posts: [], total: 0 });
      await controller.list(reqWithRole('ADMIN'), '2', '10', undefined);
      expect(mockBlogService.list).toHaveBeenCalledWith(2, 10, {
        canManage: true,
        published: undefined,
      });
    });

    it('filtra por published quando admin', async () => {
      mockBlogService.list.mockResolvedValue({ posts: [], total: 0 });
      await controller.list(reqWithRole('SUPERADMIN'), '1', '24', 'true');
      expect(mockBlogService.list).toHaveBeenCalledWith(1, 24, {
        canManage: true,
        published: true,
      });
    });

    it('ignora filtro published quando usuário comum', async () => {
      mockBlogService.list.mockResolvedValue({ posts: [], total: 0 });
      await controller.list(reqWithRole('USER'), '1', '24', 'false');
      expect(mockBlogService.list).toHaveBeenCalledWith(1, 24, {
        canManage: false,
        published: undefined,
      });
    });
  });

  describe('findPublishedBySlug', () => {
    it('busca artigo publicado por slug', async () => {
      mockBlogService.findPublishedBySlug.mockResolvedValue({ id: 'a1' });
      const result = await controller.findPublishedBySlug('meu-post');
      expect(result).toEqual({ id: 'a1' });
      expect(mockBlogService.findPublishedBySlug).toHaveBeenCalledWith(
        'meu-post',
      );
    });
  });

  describe('findById', () => {
    it('busca artigo por id (admin)', async () => {
      mockBlogService.findById.mockResolvedValue({ id: 'a1' });
      const result = await controller.findById('a1');
      expect(result).toEqual({ id: 'a1' });
      expect(mockBlogService.findById).toHaveBeenCalledWith('a1');
    });
  });

  describe('create', () => {
    it('cria artigo', async () => {
      const dto = { title: 'Novo', content: '<p>x</p>', slug: 'novo' };
      mockBlogService.create.mockResolvedValue({ id: 'a1' });
      const result = await controller.create(dto as any);
      expect(result).toEqual({ id: 'a1' });
      expect(mockBlogService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('atualiza artigo', async () => {
      const dto = { title: 'Editado' };
      mockBlogService.update.mockResolvedValue({ id: 'a1' });
      const result = await controller.update('a1', dto);
      expect(result).toEqual({ id: 'a1' });
      expect(mockBlogService.update).toHaveBeenCalledWith('a1', dto);
    });
  });

  describe('remove', () => {
    it('remove artigo', async () => {
      mockBlogService.remove.mockResolvedValue({ deleted: true });
      const result = await controller.remove('a1');
      expect(result).toEqual({ deleted: true });
      expect(mockBlogService.remove).toHaveBeenCalledWith('a1');
    });
  });
});
