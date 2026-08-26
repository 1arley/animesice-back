import { RoomController } from './room.controller';

describe('RoomController', () => {
  let controller: RoomController;
  const mockRoomService = {
    createRoom: jest.fn(),
    getRoomBySlug: jest.fn(),
    getMessages: jest.fn(),
    deleteRoom: jest.fn(),
  };

  const req = (userId = 'user-1') => ({ user: { id: userId } }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RoomController(mockRoomService as any);
  });

  describe('create', () => {
    it('cria sala com sucesso', async () => {
      const dto = { animeSlug: 'solo', episodeNumber: 1 };
      mockRoomService.createRoom.mockResolvedValue({ id: 'r1', slug: 'abc' });
      const result = await controller.create(req(), dto);
      expect(result).toEqual({ id: 'r1', slug: 'abc' });
      expect(mockRoomService.createRoom).toHaveBeenCalledWith('user-1', dto);
    });
  });

  describe('getBySlug', () => {
    it('busca sala por slug', async () => {
      mockRoomService.getRoomBySlug.mockResolvedValue({
        id: 'r1',
        slug: 'abc',
      });
      const result = await controller.getBySlug('abc');
      expect(result).toEqual({ id: 'r1', slug: 'abc' });
      expect(mockRoomService.getRoomBySlug).toHaveBeenCalledWith('abc');
    });
  });

  describe('getMessages', () => {
    it('retorna mensagens da sala', async () => {
      mockRoomService.getRoomBySlug.mockResolvedValue({ id: 'r1' });
      mockRoomService.getMessages.mockResolvedValue([{ content: 'hi' }]);
      const result = await controller.getMessages('abc');
      expect(result).toEqual([{ content: 'hi' }]);
      expect(mockRoomService.getMessages).toHaveBeenCalledWith('r1');
    });
  });

  describe('delete', () => {
    it('deleta sala', async () => {
      mockRoomService.getRoomBySlug.mockResolvedValue({ id: 'r1' });
      mockRoomService.deleteRoom.mockResolvedValue({ deleted: true });
      const result = await controller.delete(req(), 'abc');
      expect(result).toEqual({ deleted: true });
      expect(mockRoomService.deleteRoom).toHaveBeenCalledWith('user-1', 'r1');
    });
  });
});
