import { Test, TestingModule } from '@nestjs/testing';
import { MeController } from '@/me/me.controller';
import { MeService } from '@/me/me.service';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('MeController', () => {
  let controller: MeController;
  let meService: MeService;

  const mockMeService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    getMyActivity: jest.fn(),
    getMyStats: jest.fn(),
    getMyPublicView: jest.fn(),
    deleteMe: jest.fn(),
  };

  const req = {
    user: { id: 'user-1', email: 'a@b.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeController],
      providers: [{ provide: MeService, useValue: mockMeService }],
    }).compile();

    controller = module.get<MeController>(MeController);
    meService = module.get<MeService>(MeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve retornar o próprio perfil', async () => {
    mockMeService.getProfile.mockResolvedValue({ id: 'user-1' });
    const result = await controller.getProfile(req);
    expect(result).toEqual({ id: 'user-1' });
    expect(meService.getProfile).toHaveBeenCalledWith('user-1');
  });

  it('deve atualizar o perfil do usuário', async () => {
    mockMeService.updateProfile.mockResolvedValue({ id: 'user-1' });
    const dto = { name: 'Novo' };
    const result = await controller.updateProfile(req, dto);
    expect(result).toEqual({ id: 'user-1' });
    expect(meService.updateProfile).toHaveBeenCalledWith('user-1', dto);
  });

  it('deve listar atividade com parse de page/limit', async () => {
    mockMeService.getMyActivity.mockResolvedValue({ data: [] });
    await controller.getMyActivity(req, '3', '15');
    expect(meService.getMyActivity).toHaveBeenCalledWith('user-1', 3, 15);
  });

  it('deve usar padrões quando page/limit não informados', async () => {
    mockMeService.getMyActivity.mockResolvedValue({ data: [] });
    await controller.getMyActivity(req, undefined as any, undefined as any);
    expect(meService.getMyActivity).toHaveBeenCalledWith('user-1', 1, 20);
  });

  it('deve retornar estatísticas do próprio perfil', async () => {
    mockMeService.getMyStats.mockResolvedValue({ comments: 1 });
    const result = await controller.getMyStats(req);
    expect(result).toEqual({ comments: 1 });
    expect(meService.getMyStats).toHaveBeenCalledWith('user-1');
  });

  it('deve retornar visão pública do próprio perfil', async () => {
    mockMeService.getMyPublicView.mockResolvedValue({ id: 'user-1' });
    const result = await controller.getMyPublicView(req);
    expect(result).toEqual({ id: 'user-1' });
    expect(meService.getMyPublicView).toHaveBeenCalledWith('user-1');
  });

  it('deve excluir a própria conta', async () => {
    mockMeService.deleteMe.mockResolvedValue({ message: 'Conta excluída' });
    const result = await controller.deleteMe(req);
    expect(result).toEqual({ message: 'Conta excluída' });
    expect(meService.deleteMe).toHaveBeenCalledWith('user-1');
  });

  it('deve propagar erro do serviço ao obter perfil', async () => {
    mockMeService.getProfile.mockRejectedValue(new Error('boom'));
    await expect(controller.getProfile(req)).rejects.toThrow('boom');
  });
});
