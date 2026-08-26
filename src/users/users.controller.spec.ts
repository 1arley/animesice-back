import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from '@/users/users.controller';
import { UsersService } from '@/users/users.service';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: UsersService;

  const mockUsersService = {
    searchUsers: jest.fn(),
    getPublicProfile: jest.fn(),
    getUserComments: jest.fn(),
    getUserRatings: jest.fn(),
    getUserFavorites: jest.fn(),
    getUserAnimeList: jest.fn(),
    getUserActivity: jest.fn(),
    getUserStats: jest.fn(),
    reportUser: jest.fn(),
  };

  const req = {
    user: { id: 'user-1', email: 'a@b.com', role: 'USER', isVerified: true },
  } as unknown as AuthenticatedRequest;

  const optionalReq = {
    user: { id: 'user-1' },
  } as any;

  const anonReq = {
    user: undefined,
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve buscar diretório de usuários autenticado', async () => {
    mockUsersService.searchUsers.mockResolvedValue({ data: [] });
    await controller.searchUsers(optionalReq, 'John', 'new', '2', '10');
    expect(usersService.searchUsers).toHaveBeenCalledWith(
      'user-1',
      'John',
      'new',
      2,
      10,
    );
  });

  it('deve buscar diretório anônimo', async () => {
    mockUsersService.searchUsers.mockResolvedValue({ data: [] });
    await controller.searchUsers(
      anonReq,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(usersService.searchUsers).toHaveBeenCalledWith(
      null,
      undefined,
      undefined,
      1,
      24,
    );
  });

  it('deve retornar perfil público de usuário', async () => {
    mockUsersService.getPublicProfile.mockResolvedValue({ id: 'u1' });
    const result = await controller.getPublicProfile('u1');
    expect(result).toEqual({ id: 'u1' });
    expect(usersService.getPublicProfile).toHaveBeenCalledWith('u1');
  });

  it('deve listar comentários públicos', async () => {
    await controller.getUserComments('u1', '2', '10');
    expect(usersService.getUserComments).toHaveBeenCalledWith('u1', 2, 10);
  });

  it('deve usar padrões de paginação para comentários', async () => {
    await controller.getUserComments('u1', undefined as any, undefined as any);
    expect(usersService.getUserComments).toHaveBeenCalledWith('u1', 1, 20);
  });

  it('deve listar avaliações públicas', async () => {
    await controller.getUserRatings('u1', '1', '5');
    expect(usersService.getUserRatings).toHaveBeenCalledWith('u1', 1, 5);
  });

  it('deve listar favoritos públicos', async () => {
    await controller.getUserFavorites('u1', '1', '20');
    expect(usersService.getUserFavorites).toHaveBeenCalledWith('u1', 1, 20);
  });

  it('deve listar anime-list pública', async () => {
    await controller.getUserAnimeList('u1', '2', '10', 'WATCHING');
    expect(usersService.getUserAnimeList).toHaveBeenCalledWith(
      'u1',
      2,
      10,
      'WATCHING',
    );
  });

  it('deve listar atividade pública', async () => {
    await controller.getUserActivity('u1', '3', '15');
    expect(usersService.getUserActivity).toHaveBeenCalledWith('u1', 3, 15);
  });

  it('deve retornar estatísticas públicas', async () => {
    mockUsersService.getUserStats.mockResolvedValue({ comments: 1 });
    const result = await controller.getUserStats('u1');
    expect(result).toEqual({ comments: 1 });
    expect(usersService.getUserStats).toHaveBeenCalledWith('u1');
  });

  it('deve denunciar usuário', async () => {
    mockUsersService.reportUser.mockResolvedValue({ id: 'r1' });
    const dto = { reason: 'SPAM', notes: 'text' };
    const result = await controller.reportUser(req, 'u1', dto as any);
    expect(result).toEqual({ id: 'r1' });
    expect(usersService.reportUser).toHaveBeenCalledWith(
      'user-1',
      'u1',
      'SPAM',
      'text',
    );
  });

  it('deve propagar erro ao buscar perfil', async () => {
    mockUsersService.getPublicProfile.mockRejectedValue(new Error('boom'));
    await expect(controller.getPublicProfile('x')).rejects.toThrow('boom');
  });
});
