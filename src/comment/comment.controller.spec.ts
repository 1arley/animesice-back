import { Test, TestingModule } from '@nestjs/testing';
import { CommentController } from '@/comment/comment.controller';
import { CommentService } from '@/comment/comment.service';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('CommentController', () => {
  let controller: CommentController;
  let commentService: CommentService;

  const mockCommentService = {
    create: jest.fn(),
    findByAnime: jest.fn(),
    findByEpisode: jest.fn(),
    findReplies: jest.fn(),
    edit: jest.fn(),
    toggleLike: jest.fn(),
    remove: jest.fn(),
  };

  const req = {
    user: { id: 'user-1', email: 'a@b.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentController],
      providers: [{ provide: CommentService, useValue: mockCommentService }],
    }).compile();

    controller = module.get<CommentController>(CommentController);
    commentService = module.get<CommentService>(CommentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve criar comentário', async () => {
    const dto = { content: 'teste', animeId: 'a1' };
    mockCommentService.create.mockResolvedValue({ id: 'c1' });
    const result = await controller.create(req, dto);
    expect(result).toEqual({ id: 'c1' });
    expect(commentService.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('deve listar comentários de anime com parse de page/limit', async () => {
    await controller.findByAnime('a1', '2', '30');
    expect(commentService.findByAnime).toHaveBeenCalledWith('a1', 2, 30);
  });

  it('deve usar padrões quando page/limit não informados (anime)', async () => {
    await controller.findByAnime('a1', undefined as any, undefined as any);
    expect(commentService.findByAnime).toHaveBeenCalledWith('a1', 1, 50);
  });

  it('deve listar comentários de episódio', async () => {
    await controller.findByEpisode('e1', '1', '10');
    expect(commentService.findByEpisode).toHaveBeenCalledWith('e1', 1, 10);
  });

  it('deve listar respostas de um comentário', async () => {
    await controller.findByReplies('c1', '1', '10');
    expect(commentService.findReplies).toHaveBeenCalledWith('c1', 1, 10);
  });

  it('deve editar comentário', async () => {
    const dto = { content: 'novo' };
    mockCommentService.edit.mockResolvedValue({ id: 'c1' });
    const result = await controller.edit(req, 'c1', dto);
    expect(result).toEqual({ id: 'c1' });
    expect(commentService.edit).toHaveBeenCalledWith('user-1', 'c1', dto);
  });

  it('deve alternar like do comentário', async () => {
    mockCommentService.toggleLike.mockResolvedValue({ liked: true });
    const result = await controller.toggleLike(req, 'c1');
    expect(result).toEqual({ liked: true });
    expect(commentService.toggleLike).toHaveBeenCalledWith('user-1', 'c1');
  });

  it('deve remover comentário', async () => {
    mockCommentService.remove.mockResolvedValue({ id: 'c1' });
    const result = await controller.remove(req, 'c1');
    expect(result).toEqual({ id: 'c1' });
    expect(commentService.remove).toHaveBeenCalledWith('user-1', 'c1');
  });

  it('deve propagar erro ao criar comentário', async () => {
    mockCommentService.create.mockRejectedValue(new Error('boom'));
    await expect(
      controller.create(req, { content: 'x' } as any),
    ).rejects.toThrow('boom');
  });
});
