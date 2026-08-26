import { Test, TestingModule } from '@nestjs/testing';
import { ModerationController } from '@/moderation/moderation.controller';
import { ModerationService } from '@/moderation/moderation.service';
import { ReportStatus } from '@prisma/client';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('ModerationController', () => {
  let controller: ModerationController;
  let moderationService: ModerationService;

  const mockModerationService = {
    createReport: jest.fn(),
    listReports: jest.fn(),
    resolveReport: jest.fn(),
    moderateUser: jest.fn(),
    deleteComment: jest.fn(),
    adminListPosts: jest.fn(),
    adminHidePost: jest.fn(),
    adminDeletePost: jest.fn(),
  };

  const req = {
    user: { id: 'admin-1', email: 'a@b.com', role: 'ADMIN', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModerationController],
      providers: [
        { provide: ModerationService, useValue: mockModerationService },
      ],
    }).compile();

    controller = module.get<ModerationController>(ModerationController);
    moderationService = module.get<ModerationService>(ModerationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve criar denúncia', async () => {
    const dto = { targetType: 'COMMENT', targetId: 'c1', reason: 'SPAM' };
    mockModerationService.createReport.mockResolvedValue({ id: 'r1' });
    const result = await controller.createReport(req, dto as any);
    expect(result).toEqual({ id: 'r1' });
    expect(moderationService.createReport).toHaveBeenCalledWith('admin-1', dto);
  });

  it('deve listar denúncias (admin)', async () => {
    await controller.listReports('2', '10', 'PENDING');
    expect(moderationService.listReports).toHaveBeenCalledWith(
      2,
      10,
      'PENDING',
    );
  });

  it('deve usar padrões de paginação ao listar denúncias', async () => {
    await controller.listReports(undefined as any, undefined as any, undefined);
    expect(moderationService.listReports).toHaveBeenCalledWith(
      1,
      20,
      undefined,
    );
  });

  it('deve resolver denúncia como RESOLVED', async () => {
    const dto = { moderationNote: 'ok' };
    mockModerationService.resolveReport.mockResolvedValue({ id: 'r1' });
    const result = await controller.resolveReport(req, 'r1', dto);
    expect(result).toEqual({ id: 'r1' });
    expect(moderationService.resolveReport).toHaveBeenCalledWith(
      'r1',
      'admin-1',
      ReportStatus.RESOLVED,
      dto,
    );
  });

  it('deve rejeitar denúncia como DISMISSED', async () => {
    const dto = { moderationNote: 'ok' };
    mockModerationService.resolveReport.mockResolvedValue({ id: 'r1' });
    const result = await controller.dismissReport(req, 'r1', dto);
    expect(result).toEqual({ id: 'r1' });
    expect(moderationService.resolveReport).toHaveBeenCalledWith(
      'r1',
      'admin-1',
      ReportStatus.DISMISSED,
      dto,
    );
  });

  it('deve moderar usuário', async () => {
    const dto = { actionType: 'MUTE', reason: 'spam' };
    mockModerationService.moderateUser.mockResolvedValue({ id: 'a1' });
    const result = await controller.moderateUser(req, 'u1', dto as any);
    expect(result).toEqual({ id: 'a1' });
    expect(moderationService.moderateUser).toHaveBeenCalledWith(
      'u1',
      'admin-1',
      dto,
    );
  });

  it('deve ocultar comentário via moderação', async () => {
    mockModerationService.deleteComment.mockResolvedValue({ id: 'c1' });
    const result = await controller.deleteComment('c1');
    expect(result).toEqual({ id: 'c1' });
    expect(moderationService.deleteComment).toHaveBeenCalledWith('c1', '');
  });

  it('deve listar posts para admin', async () => {
    await controller.listPostsForAdmin('3', '5', 'VISIBLE');
    expect(moderationService.adminListPosts).toHaveBeenCalledWith(
      3,
      5,
      'VISIBLE',
    );
  });

  it('deve ocultar post via moderação', async () => {
    mockModerationService.adminHidePost.mockResolvedValue({ id: 'p1' });
    const result = await controller.hidePost('p1');
    expect(result).toEqual({ id: 'p1' });
    expect(moderationService.adminHidePost).toHaveBeenCalledWith('p1');
  });

  it('deve excluir post permanentemente', async () => {
    mockModerationService.adminDeletePost.mockResolvedValue({ message: 'ok' });
    const result = await controller.deletePost('p1');
    expect(result).toEqual({ message: 'ok' });
    expect(moderationService.adminDeletePost).toHaveBeenCalledWith('p1');
  });

  it('deve propagar erro ao resolver denúncia', async () => {
    mockModerationService.resolveReport.mockRejectedValue(new Error('boom'));
    await expect(controller.resolveReport(req, 'x', {} as any)).rejects.toThrow(
      'boom',
    );
  });
});
