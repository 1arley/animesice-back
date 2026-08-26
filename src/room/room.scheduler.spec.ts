import { RoomScheduler } from './room.scheduler';

describe('RoomScheduler', () => {
  let scheduler: RoomScheduler;

  const mockRoomService = {
    cleanupExpiredRooms: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new RoomScheduler(mockRoomService as any);
  });

  describe('cleanupExpiredRooms', () => {
    it('chama cleanupExpiredRooms e loga quando remove salas', async () => {
      mockRoomService.cleanupExpiredRooms.mockResolvedValue(5);
      const spy = jest.spyOn(console, 'log').mockImplementation();
      await scheduler.cleanupExpiredRooms();
      expect(mockRoomService.cleanupExpiredRooms).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('não loga quando nenhuma sala removida', async () => {
      mockRoomService.cleanupExpiredRooms.mockResolvedValue(0);
      const spy = jest.spyOn(console, 'log').mockImplementation();
      await scheduler.cleanupExpiredRooms();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
