import { Test, TestingModule } from '@nestjs/testing';
import { SocialController } from '@/social/social.controller';
import { SocialService } from '@/social/social.service';

describe('SocialController', () => {
  let controller: SocialController;

  const mockSocialService = {
    createPost: jest.fn(),
    getFeed: jest.fn(),
    getPost: jest.fn(),
    deletePost: jest.fn(),
    togglePostLike: jest.fn(),
    getPostComments: jest.fn(),
    createPostComment: jest.fn(),
    sharePost: jest.fn(),
    toggleFollow: jest.fn(),
    checkFollow: jest.fn(),
    getFollowing: jest.fn(),
    getFollowingForUser: jest.fn(),
    getFollowers: jest.fn(),
  };

  const mockReq = (userId = 'user-1') => ({ user: { id: userId } }) as any;

  const optReq = (userId: string | null = 'user-1') =>
    ({ user: userId ? { id: userId } : undefined }) as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [{ provide: SocialService, useValue: mockSocialService }],
    }).compile();

    controller = module.get<SocialController>(SocialController);
  });

  describe('createPost', () => {
    it('cria post com sucesso', async () => {
      const dto = { content: 'Bom dia!', animeId: 'a1' };
      mockSocialService.createPost.mockResolvedValue({ id: 'p1' });
      const result = await controller.createPost(mockReq(), dto);
      expect(result).toEqual({ id: 'p1' });
      expect(mockSocialService.createPost).toHaveBeenCalledWith('user-1', dto);
    });
  });

  describe('getFeed', () => {
    it('retorna feed global com defaults', async () => {
      mockSocialService.getFeed.mockResolvedValue({ posts: [] });
      await controller.getFeed(optReq(), '', '', '');
      expect(mockSocialService.getFeed).toHaveBeenCalledWith(
        'user-1',
        1,
        20,
        'global',
      );
    });

    it('retorna feed following', async () => {
      mockSocialService.getFeed.mockResolvedValue({ posts: [] });
      await controller.getFeed(optReq(null), '2', '10', 'following');
      expect(mockSocialService.getFeed).toHaveBeenCalledWith(
        null,
        2,
        10,
        'following',
      );
    });
  });

  describe('getPost', () => {
    it('busca post por id', async () => {
      mockSocialService.getPost.mockResolvedValue({ id: 'p1' });
      await controller.getPost(optReq(), 'p1');
      expect(mockSocialService.getPost).toHaveBeenCalledWith('p1', 'user-1');
    });
  });

  describe('deletePost', () => {
    it('deleta post', async () => {
      mockSocialService.deletePost.mockResolvedValue({ deleted: true });
      await controller.deletePost(mockReq(), 'p1');
      expect(mockSocialService.deletePost).toHaveBeenCalledWith('user-1', 'p1');
    });
  });

  describe('togglePostLike', () => {
    it('curte/descurte post', async () => {
      mockSocialService.togglePostLike.mockResolvedValue({ liked: true });
      await controller.togglePostLike(mockReq(), 'p1');
      expect(mockSocialService.togglePostLike).toHaveBeenCalledWith(
        'user-1',
        'p1',
      );
    });
  });

  describe('getPostComments', () => {
    it('retorna comentários de um post', async () => {
      mockSocialService.getPostComments.mockResolvedValue([]);
      await controller.getPostComments('p1', '1', '10');
      expect(mockSocialService.getPostComments).toHaveBeenCalledWith(
        'p1',
        1,
        10,
      );
    });
  });

  describe('createPostComment', () => {
    it('cria comentário', async () => {
      const dto = { content: 'Ótimo!' };
      mockSocialService.createPostComment.mockResolvedValue({ id: 'c1' });
      await controller.createPostComment(mockReq(), 'p1', dto);
      expect(mockSocialService.createPostComment).toHaveBeenCalledWith(
        'user-1',
        'p1',
        dto,
      );
    });
  });

  describe('sharePost', () => {
    it('contabiliza compartilhamento', async () => {
      mockSocialService.sharePost.mockResolvedValue({ shareCount: 5 });
      await controller.sharePost(mockReq(), 'p1');
      expect(mockSocialService.sharePost).toHaveBeenCalledWith('p1');
    });
  });

  describe('toggleFollow', () => {
    it('segue/deixa de seguir usuário', async () => {
      mockSocialService.toggleFollow.mockResolvedValue({ following: true });
      await controller.toggleFollow(mockReq(), 'user-2');
      expect(mockSocialService.toggleFollow).toHaveBeenCalledWith(
        'user-1',
        'user-2',
      );
    });
  });

  describe('checkFollow', () => {
    it('verifica se já segue', async () => {
      mockSocialService.checkFollow.mockResolvedValue({ following: true });
      await controller.checkFollow(mockReq(), 'user-2');
      expect(mockSocialService.checkFollow).toHaveBeenCalledWith(
        'user-1',
        'user-2',
      );
    });
  });

  describe('getFollowing', () => {
    it('lista quem o usuário segue', async () => {
      mockSocialService.getFollowing.mockResolvedValue([]);
      await controller.getFollowing(mockReq(), '1', '20');
      expect(mockSocialService.getFollowing).toHaveBeenCalledWith(
        'user-1',
        1,
        20,
      );
    });
  });

  describe('getFollowingForUser', () => {
    it('lista quem um usuário segue (público)', async () => {
      mockSocialService.getFollowingForUser.mockResolvedValue([]);
      await controller.getFollowingForUser(optReq(), 'user-2', '1', '20');
      expect(mockSocialService.getFollowingForUser).toHaveBeenCalledWith(
        'user-2',
        'user-1',
        1,
        20,
      );
    });
  });

  describe('getFollowers', () => {
    it('lista seguidores de um usuário', async () => {
      mockSocialService.getFollowers.mockResolvedValue([]);
      await controller.getFollowers(optReq(), 'user-2', '1', '20');
      expect(mockSocialService.getFollowers).toHaveBeenCalledWith(
        'user-2',
        'user-1',
        1,
        20,
      );
    });
  });
});
