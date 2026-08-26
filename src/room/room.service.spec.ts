import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { RoomService } from './room.service';

function makePrisma() {
  return {
    anime: {
      findUnique: jest.fn(),
    },
    episode: {
      findFirst: jest.fn(),
    },
    room: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    roomMessage: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };
}

describe('RoomService', () => {
  let service: RoomService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new RoomService(prisma as any);
    jest.clearAllMocks();
  });

  describe('createRoom', () => {
    const dto = { animeSlug: 'solo', episodeNumber: 1 };

    it('cria sala com sucesso', async () => {
      prisma.anime.findUnique.mockResolvedValue({
        id: 'a1',
        slug: 'solo',
        title: 'Solo',
      });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.room.create.mockResolvedValue({
        id: 'r1',
        slug: 'generated',
        animeSlug: 'solo',
        episodeNumber: 1,
        maxParticipants: 20,
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      const result = await service.createRoom('user-1', dto);
      expect(result.id).toBe('r1');
      expect(prisma.room.create).toHaveBeenCalled();
    });

    it('usa maxParticipants informado no DTO', async () => {
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.room.create.mockResolvedValue({
        id: 'r1',
        slug: 'generated',
        maxParticipants: 30,
        createdAt: new Date(),
      });

      await service.createRoom('user-1', { ...dto, maxParticipants: 30 });
      expect(prisma.room.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ maxParticipants: 30 }),
        }),
      );
    });

    it('lança NotFoundException quando anime não encontrado', async () => {
      prisma.anime.findUnique.mockResolvedValue(null);
      await expect(service.createRoom('user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lança NotFoundException quando episódio não encontrado', async () => {
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue(null);
      await expect(service.createRoom('user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('tenta novamente em caso de slug colidente (P2002)', async () => {
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1' });
      const err = new Error('Unique constraint failed');
      (err as any).code = 'P2002';
      prisma.room.create.mockRejectedValueOnce(err).mockResolvedValueOnce({
        id: 'r2',
        slug: 'generated2',
        createdAt: new Date(),
      });

      const result = await service.createRoom('user-1', dto);
      expect(result.id).toBe('r2');
      expect(prisma.room.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRoomBySlug', () => {
    it('retorna sala válida', async () => {
      const future = new Date(Date.now() + 3600000);
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        slug: 'abc',
        expiresAt: future,
        lastActivityAt: new Date(),
        creatorId: 'u1',
      });
      const result = await service.getRoomBySlug('abc');
      expect(result.id).toBe('r1');
    });

    it('lança NotFoundException quando sala não existe', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(service.getRoomBySlug('none')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lança NotFoundException quando sala expirou', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        slug: 'abc',
        expiresAt: new Date(Date.now() - 3600000),
        lastActivityAt: new Date(),
        creatorId: 'u1',
      });
      await expect(service.getRoomBySlug('abc')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMessages', () => {
    it('retorna mensagens com user info', async () => {
      prisma.roomMessage.findMany.mockResolvedValue([
        { content: 'hi', user: { id: 'u1', name: 'X' } },
      ]);
      const result = await service.getMessages('r1');
      expect(result).toHaveLength(1);
      expect(prisma.roomMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('clampa limit entre 1 e 100', async () => {
      prisma.roomMessage.findMany.mockResolvedValue([]);
      await service.getMessages('r1', 0);
      expect(prisma.roomMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
      await service.getMessages('r1', 999);
      expect(prisma.roomMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('createMessage', () => {
    it('cria mensagem com sucesso', async () => {
      const future = new Date(Date.now() + 3600000);
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        expiresAt: future,
      });
      prisma.roomMessage.create.mockResolvedValue({
        id: 'm1',
        content: 'hello',
        user: { id: 'u1', name: 'X' },
      });

      const result = await service.createMessage('r1', 'u1', 'hello');
      expect(result!.content).toBe('hello');
    });

    it('retorna null quando conteúdo é vazio após trim', async () => {
      const result = await service.createMessage('r1', 'u1', '   ');
      expect(result).toBeNull();
    });

    it('lança BadRequestException quando sala não existe ou expirou', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(service.createMessage('none', 'u1', 'hi')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('trunca conteúdo para 500 chars', async () => {
      const future = new Date(Date.now() + 3600000);
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', expiresAt: future });
      prisma.roomMessage.create.mockResolvedValue({ id: 'm1' });

      await service.createMessage('r1', 'u1', 'x'.repeat(600));
      expect(prisma.roomMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ content: 'x'.repeat(500) }),
        }),
      );
    });
  });

  describe('touchActivity', () => {
    it('atualiza lastActivityAt quando stale', async () => {
      prisma.room.updateMany.mockResolvedValue({ count: 1 });
      await service.touchActivity('r1');
      expect(prisma.room.updateMany).toHaveBeenCalled();
    });
  });

  describe('getParticipantCount', () => {
    it('retorna contagem de participantes únicos', async () => {
      prisma.roomMessage.findMany.mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
      ]);
      const count = await service.getParticipantCount('r1');
      expect(count).toBe(2);
    });
  });

  describe('deleteRoom', () => {
    it('deleta sala com sucesso', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        creatorId: 'user-1',
      });
      prisma.room.delete.mockResolvedValue({ id: 'r1' });
      const result = await service.deleteRoom('user-1', 'r1');
      expect(result.id).toBe('r1');
    });

    it('lança NotFoundException quando sala não existe', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(service.deleteRoom('user-1', 'none')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lança ForbiddenException quando não é o criador', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        creatorId: 'other-user',
      });
      await expect(service.deleteRoom('user-1', 'r1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('cleanupExpiredRooms', () => {
    it('retorna contagem de salas deletadas', async () => {
      prisma.room.deleteMany.mockResolvedValue({ count: 3 });
      const count = await service.cleanupExpiredRooms();
      expect(count).toBe(3);
      expect(prisma.room.deleteMany).toHaveBeenCalled();
    });
  });
});
