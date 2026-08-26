import { Test, TestingModule } from '@nestjs/testing';
import { CommunityController } from '@/community/community.controller';
import { CommunityService } from '@/community/community.service';
import { FeedbackStatus } from '@prisma/client';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('CommunityController', () => {
  let controller: CommunityController;
  let communityService: CommunityService;

  const mockCommunityService = {
    listRequests: jest.fn(),
    createRequest: jest.fn(),
    voteRequest: jest.fn(),
    adminUpdateRequestStatus: jest.fn(),
    listFeedback: jest.fn(),
    createFeedback: jest.fn(),
    upvoteFeedback: jest.fn(),
    adminUpdateFeedbackStatus: jest.fn(),
  };

  const req = {
    user: { id: 'user-1', email: 'a@b.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommunityController],
      providers: [
        { provide: CommunityService, useValue: mockCommunityService },
      ],
    }).compile();

    controller = module.get<CommunityController>(CommunityController);
    communityService = module.get<CommunityService>(CommunityService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve listar pedidos de anime', async () => {
    await controller.listRequests('2', '10', 'OPEN');
    expect(communityService.listRequests).toHaveBeenCalledWith(2, 10, 'OPEN');
  });

  it('deve criar pedido de anime', async () => {
    const dto = { title: 'Naruto' };
    mockCommunityService.createRequest.mockResolvedValue({ id: 'r1' });
    const result = await controller.createRequest(req, dto);
    expect(result).toEqual({ id: 'r1' });
    expect(communityService.createRequest).toHaveBeenCalledWith('user-1', dto);
  });

  it('deve votar em pedido de anime', async () => {
    mockCommunityService.voteRequest.mockResolvedValue({
      voted: true,
      voteCount: 1,
    });
    const result = await controller.voteRequest(req, 'r1');
    expect(result).toEqual({ voted: true, voteCount: 1 });
    expect(communityService.voteRequest).toHaveBeenCalledWith('r1', 'user-1');
  });

  it('deve atualizar status de pedido como admin', async () => {
    mockCommunityService.adminUpdateRequestStatus.mockResolvedValue({
      id: 'r1',
    });
    const body = { status: FeedbackStatus.RESOLVED, adminNote: 'nota' };
    const result = await controller.adminUpdateRequest('r1', body);
    expect(result).toEqual({ id: 'r1' });
    expect(communityService.adminUpdateRequestStatus).toHaveBeenCalledWith(
      'r1',
      FeedbackStatus.RESOLVED,
      'nota',
    );
  });

  it('deve listar feedbacks do site', async () => {
    await controller.listFeedback('1', '10', 'BUG', 'OPEN');
    expect(communityService.listFeedback).toHaveBeenCalledWith(
      1,
      10,
      'BUG',
      'OPEN',
    );
  });

  it('deve criar feedback', async () => {
    const dto = { type: 'SUGGESTION', title: 'Ideia', description: 'desc' };
    mockCommunityService.createFeedback.mockResolvedValue({ id: 'f1' });
    const result = await controller.createFeedback(req, dto as any);
    expect(result).toEqual({ id: 'f1' });
    expect(communityService.createFeedback).toHaveBeenCalledWith('user-1', dto);
  });

  it('deve dar upvote em feedback', async () => {
    mockCommunityService.upvoteFeedback.mockResolvedValue({
      id: 'f1',
      upvotes: 1,
    });
    const result = await controller.upvoteFeedback('f1');
    expect(result).toHaveProperty('upvotes', 1);
    expect(communityService.upvoteFeedback).toHaveBeenCalledWith('f1');
  });

  it('deve atualizar status de feedback como admin', async () => {
    mockCommunityService.adminUpdateFeedbackStatus.mockResolvedValue({
      id: 'f1',
    });
    const body = { status: FeedbackStatus.COMPLETED };
    const result = await controller.adminUpdateFeedback('f1', body);
    expect(result).toEqual({ id: 'f1' });
    expect(communityService.adminUpdateFeedbackStatus).toHaveBeenCalledWith(
      'f1',
      FeedbackStatus.COMPLETED,
      undefined,
    );
  });

  it('deve propagar erro ao criar pedido', async () => {
    mockCommunityService.createRequest.mockRejectedValue(new Error('boom'));
    await expect(
      controller.createRequest(req, { title: 'x' } as any),
    ).rejects.toThrow('boom');
  });
});
