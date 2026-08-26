import { Test } from '@nestjs/testing';
import { RoomGateway } from './room.gateway';
import { RoomService } from '@/room/room.service';
import { ModerationService } from '@/moderation/moderation.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';

function makeSocket(overrides: Record<string, any> = {}) {
  return {
    id: 'sock1',
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    disconnect: jest.fn(),
    to: jest.fn().mockReturnThis(),
    data: {},
    rooms: new Set<string>(),
    handshake: { auth: {}, headers: {} },
    request: { user: { id: 'user-1' } },
    ...overrides,
  } as any;
}

function makeParticipant(overrides: Record<string, any> = {}) {
  return {
    roomSlug: 'abc',
    userId: 'user-1',
    socketId: 'sock1',
    userName: 'alice',
    name: 'Alice',
    avatar: 'a.png',
    isHost: false,
    ...overrides,
  };
}

const makeRoom = (overrides: Record<string, any> = {}) => ({
  id: 'r1',
  slug: 'abc',
  creatorId: 'user-1',
  animeSlug: 'solo',
  episodeNumber: 1,
  maxParticipants: 20,
  expiresAt: new Date(Date.now() + 3_600_000),
  lastActivityAt: new Date(),
  createdAt: new Date(),
  ...overrides,
});

describe('RoomGateway', () => {
  let gateway: RoomGateway;
  let server: any;

  const mocks = {
    roomService: {
      getRoomBySlug: jest.fn(),
      getMessages: jest.fn(),
      createMessage: jest.fn(),
      touchActivity: jest.fn(),
    },
    moderationService: {
      isUserSuspended: jest.fn(),
    },
    jwtService: {
      verifyAsync: jest.fn(),
    },
    configService: {
      get: jest.fn(),
    },
    prisma: {
      user: { findUnique: jest.fn() },
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoomGateway,
        { provide: RoomService, useValue: mocks.roomService },
        { provide: ModerationService, useValue: mocks.moderationService },
        { provide: JwtService, useValue: mocks.jwtService },
        { provide: ConfigService, useValue: mocks.configService },
        { provide: PrismaService, useValue: mocks.prisma },
      ],
    }).compile();

    gateway = moduleRef.get(RoomGateway);
  });

  beforeEach(() => {
    jest.resetAllMocks();
    mocks.configService.get.mockReturnValue('test-secret');
    server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    (gateway as any).server = server;
    (gateway as any).userMap.clear();
    (gateway as any).messageTimestamps.clear();
    (gateway as any).lastMessage.clear();
    (gateway as any).roomParticipants.clear();
    (gateway as any).playerState.clear();
  });

  function addParticipant(roomId: string, participant: any) {
    if (!(gateway as any).roomParticipants.has(roomId)) {
      (gateway as any).roomParticipants.set(roomId, new Map());
    }
    (gateway as any).roomParticipants
      .get(roomId)
      .set(participant.socketId, participant);
  }

  describe('handleConnection', () => {
    it('desconecta quando não há token', async () => {
      const socket = makeSocket();
      await gateway.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
      expect(mocks.jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('conecta com token via cookie', async () => {
      const socket = makeSocket({
        handshake: {
          auth: {},
          headers: { cookie: 'access_token=token-cookie; path=/' },
        },
      });
      mocks.jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      await gateway.handleConnection(socket);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(mocks.jwtService.verifyAsync).toHaveBeenCalledWith(
        'token-cookie',
        {
          secret: 'test-secret',
        },
      );
      expect((gateway as any).userMap.get('sock1')).toBe('user-1');
    });

    it('conecta com token via auth quando não há cookie', async () => {
      const socket = makeSocket({
        handshake: { auth: { token: 'token-auth' }, headers: {} },
      });
      mocks.jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      await gateway.handleConnection(socket);
      expect(mocks.jwtService.verifyAsync).toHaveBeenCalledWith('token-auth', {
        secret: 'test-secret',
      });
      expect((gateway as any).userMap.get('sock1')).toBe('user-1');
    });

    it('usa auth quando o cookie não contém access_token', async () => {
      const socket = makeSocket({
        handshake: {
          auth: { token: 'token-auth' },
          headers: { cookie: 'outro=1' },
        },
      });
      mocks.jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      await gateway.handleConnection(socket);
      expect(mocks.jwtService.verifyAsync).toHaveBeenCalledWith('token-auth', {
        secret: 'test-secret',
      });
    });

    it('desconecta quando sub do payload não é string', async () => {
      const socket = makeSocket({
        handshake: { auth: { token: 'token-auth' }, headers: {} },
      });
      mocks.jwtService.verifyAsync.mockResolvedValue({ sub: 123 });
      await gateway.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
      expect((gateway as any).userMap.has('sock1')).toBe(false);
    });

    it('desconecta e emite suspended quando usuário está suspenso', async () => {
      const socket = makeSocket({
        handshake: { auth: { token: 'token-auth' }, headers: {} },
      });
      mocks.jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      mocks.moderationService.isUserSuspended.mockResolvedValue(true);
      await gateway.handleConnection(socket);
      expect(socket.emit).toHaveBeenCalledWith('suspended', {
        message: 'Sua conta está suspensa.',
      });
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('desconecta quando a verificação do token falha', async () => {
      const socket = makeSocket({
        handshake: { auth: { token: 'token-invalido' }, headers: {} },
      });
      mocks.jwtService.verifyAsync.mockRejectedValue(
        new Error('token inválido'),
      );
      await gateway.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
      expect((gateway as any).userMap.has('sock1')).toBe(false);
    });
  });

  describe('handleDisconnect', () => {
    it('limpa estado do usuário e remove participante da sala', async () => {
      const socket = makeSocket();
      (gateway as any).userMap.set('sock1', 'user-1');
      (gateway as any).messageTimestamps.set('user-1', [Date.now()]);
      (gateway as any).lastMessage.set('user-1', {
        content: 'oi',
        time: Date.now(),
      });
      addParticipant('r1', makeParticipant({ isHost: true }));

      gateway.handleDisconnect(socket);

      expect((gateway as any).userMap.has('sock1')).toBe(false);
      expect((gateway as any).messageTimestamps.has('user-1')).toBe(false);
      expect((gateway as any).lastMessage.has('user-1')).toBe(false);
      expect((gateway as any).roomParticipants.has('r1')).toBe(false);
      expect(server.to).toHaveBeenCalledWith('room:r1');
      expect(server.emit).toHaveBeenCalledWith('participantList', []);
    });

    it('remove participante de múltiplas salas', async () => {
      const socket = makeSocket();
      (gateway as any).userMap.set('sock1', 'user-1');
      addParticipant('r1', makeParticipant());
      addParticipant('r2', makeParticipant());
      gateway.handleDisconnect(socket);
      expect((gateway as any).roomParticipants.has('r1')).toBe(false);
      expect((gateway as any).roomParticipants.has('r2')).toBe(false);
      expect(server.emit).toHaveBeenCalledTimes(2);
    });

    it('não faz broadcast quando usuário não está em nenhuma sala', async () => {
      const socket = makeSocket();
      (gateway as any).userMap.set('sock1', 'user-1');
      gateway.handleDisconnect(socket);
      expect(server.emit).not.toHaveBeenCalled();
      expect((gateway as any).userMap.has('sock1')).toBe(false);
    });

    it('mantém a sala quando o participante desconectado não está nela', async () => {
      const socket = makeSocket();
      (gateway as any).userMap.set('sock1', 'user-1');
      addParticipant(
        'r1',
        makeParticipant({ socketId: 'sock2', userId: 'user-2' }),
      );
      gateway.handleDisconnect(socket);
      expect(server.emit).not.toHaveBeenCalled();
      expect((gateway as any).roomParticipants.has('r1')).toBe(true);
    });
  });

  describe('handleJoinRoom', () => {
    function authedSocket(overrides: Record<string, any> = {}) {
      const socket = makeSocket(overrides);
      (gateway as any).userMap.set(socket.id, 'user-1');
      return socket;
    }

    it('ignora quando usuário não está autenticado', async () => {
      const socket = makeSocket();
      await gateway.handleJoinRoom(socket, { slug: 'abc' });
      expect(mocks.roomService.getRoomBySlug).not.toHaveBeenCalled();
    });

    it('ignora quando slug não é string', async () => {
      const socket = authedSocket();
      await gateway.handleJoinRoom(socket, { slug: null } as any);
      expect(mocks.roomService.getRoomBySlug).not.toHaveBeenCalled();
    });

    it('entra na sala com sucesso como host', async () => {
      const socket = authedSocket();
      mocks.roomService.getRoomBySlug.mockResolvedValue(makeRoom());
      mocks.prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Alice',
        userName: 'alice',
        avatar: 'a.png',
      });
      mocks.roomService.touchActivity.mockResolvedValue(undefined);

      await gateway.handleJoinRoom(socket, { slug: 'abc' });

      expect(socket.join).toHaveBeenCalledWith('room:r1');
      expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: expect.anything(),
      });
      expect(mocks.roomService.touchActivity).toHaveBeenCalledWith('r1');
      expect(socket.emit).toHaveBeenCalledWith('joinedRoom', {
        roomId: 'r1',
        slug: 'abc',
        animeSlug: 'solo',
        episodeNumber: 1,
        isHost: true,
      });
      expect(server.emit).toHaveBeenCalledWith('participantList', [
        expect.objectContaining({ userId: 'user-1', isHost: true }),
      ]);
    });

    it('entra na sala mesmo sem usuário cadastrado no banco', async () => {
      const socket = authedSocket();
      mocks.roomService.getRoomBySlug.mockResolvedValue(makeRoom());
      mocks.prisma.user.findUnique.mockResolvedValue(null);
      mocks.roomService.touchActivity.mockResolvedValue(undefined);
      await gateway.handleJoinRoom(socket, { slug: 'abc' });
      expect(socket.emit).toHaveBeenCalledWith('joinedRoom', expect.anything());
      expect(server.emit).toHaveBeenCalledWith('participantList', [
        expect.objectContaining({ userName: null }),
      ]);
    });

    it('emite roomFull quando a sala está cheia', async () => {
      const socket = authedSocket();
      mocks.roomService.getRoomBySlug.mockResolvedValue(
        makeRoom({ maxParticipants: 1 }),
      );
      addParticipant(
        'r1',
        makeParticipant({ socketId: 'sock2', userId: 'user-2' }),
      );
      await gateway.handleJoinRoom(socket, { slug: 'abc' });
      expect(socket.emit).toHaveBeenCalledWith('roomFull', {
        message: 'Sala cheia.',
      });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('permite nova conexão de usuário já presente na sala', async () => {
      const socket = authedSocket({ rooms: new Set(['room:r1']) });
      mocks.roomService.getRoomBySlug.mockResolvedValue(makeRoom());
      mocks.prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Alice',
        userName: 'alice',
        avatar: 'a.png',
      });
      addParticipant('r1', makeParticipant({ socketId: 'sock-old' }));
      await gateway.handleJoinRoom(socket, { slug: 'abc' });
      expect(socket.join).toHaveBeenCalledWith('room:r1');
      expect(socket.emit).toHaveBeenCalledWith('joinedRoom', expect.anything());
    });

    it('emite erro quando a sala não é encontrada', async () => {
      const socket = authedSocket();
      mocks.roomService.getRoomBySlug.mockRejectedValue(
        new Error('sala não encontrada'),
      );
      await gateway.handleJoinRoom(socket, { slug: 'abc' });
      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Sala não encontrada.',
      });
    });

    it('envia playerSync quando existe estado salvo e não toca atividade quando não é host', async () => {
      const socket = authedSocket();
      mocks.roomService.getRoomBySlug.mockResolvedValue(
        makeRoom({ creatorId: 'creator-1' }),
      );
      mocks.prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Alice',
        userName: 'alice',
        avatar: 'a.png',
      });
      (gateway as any).playerState.set('r1', {
        currentTime: 10,
        isPlaying: false,
        updatedAt: Date.now(),
      });
      await gateway.handleJoinRoom(socket, { slug: 'abc' });
      expect(mocks.roomService.touchActivity).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('playerSync', {
        currentTime: 10,
        isPlaying: false,
        origin: 'host',
      });
    });
  });

  describe('handleLeaveRoom', () => {
    it('sai da sala e remove o participante', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1']) });
      addParticipant('r1', makeParticipant());
      gateway.handleLeaveRoom(socket, { slug: 'abc' });
      expect(socket.leave).toHaveBeenCalledWith('room:r1');
      expect((gateway as any).roomParticipants.has('r1')).toBe(false);
      expect(server.emit).toHaveBeenCalledWith('participantList', []);
    });

    it('pausa o player quando o último host sai', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1']) });
      addParticipant('r1', makeParticipant({ isHost: true }));
      addParticipant(
        'r1',
        makeParticipant({ socketId: 'sock2', userId: 'user-2' }),
      );
      (gateway as any).playerState.set('r1', {
        currentTime: 10,
        isPlaying: true,
        updatedAt: Date.now() - 5000,
      });

      gateway.handleLeaveRoom(socket, { slug: 'abc' });

      expect(server.to).toHaveBeenCalledWith('room:r1');
      expect(server.emit).toHaveBeenCalledWith(
        'playerSync',
        expect.objectContaining({ isPlaying: false, origin: 'host-left' }),
      );
      expect(server.emit).toHaveBeenCalledWith('participantList', [
        expect.objectContaining({ userId: 'user-2' }),
      ]);
      expect((gateway as any).playerState.get('r1')).toEqual(
        expect.objectContaining({ isPlaying: false }),
      );
    });

    it('mantém o player rodando quando outro host permanece', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1']) });
      addParticipant('r1', makeParticipant({ isHost: true }));
      addParticipant(
        'r1',
        makeParticipant({ socketId: 'sock2', userId: 'user-2', isHost: true }),
      );
      (gateway as any).playerState.set('r1', {
        currentTime: 10,
        isPlaying: true,
        updatedAt: Date.now(),
      });
      gateway.handleLeaveRoom(socket, { slug: 'abc' });
      expect(server.emit).not.toHaveBeenCalledWith(
        'playerSync',
        expect.anything(),
      );
    });

    it('não pausa quando o player não está tocando', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1']) });
      addParticipant('r1', makeParticipant({ isHost: true }));
      addParticipant(
        'r1',
        makeParticipant({ socketId: 'sock2', userId: 'user-2' }),
      );
      (gateway as any).playerState.set('r1', {
        currentTime: 10,
        isPlaying: false,
        updatedAt: Date.now(),
      });
      gateway.handleLeaveRoom(socket, { slug: 'abc' });
      expect(server.emit).not.toHaveBeenCalledWith(
        'playerSync',
        expect.anything(),
      );
    });

    it('sai de múltiplas salas', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1', 'room:r2']) });
      addParticipant('r1', makeParticipant());
      addParticipant('r2', makeParticipant());
      gateway.handleLeaveRoom(socket, { slug: 'abc' });
      expect(socket.leave).toHaveBeenCalledTimes(2);
      expect(server.emit).toHaveBeenCalledTimes(2);
    });

    it('não faz nada quando não há salas', async () => {
      const socket = makeSocket();
      gateway.handleLeaveRoom(socket, { slug: 'abc' });
      expect(socket.leave).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    function authedSocket(overrides: Record<string, any> = {}) {
      const socket = makeSocket(overrides);
      (gateway as any).userMap.set(socket.id, 'user-1');
      return socket;
    }

    it('ignora usuário não autenticado', async () => {
      const socket = makeSocket();
      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });
      expect(mocks.moderationService.isUserSuspended).not.toHaveBeenCalled();
    });

    it('ignora quando o conteúdo não é string', async () => {
      const socket = authedSocket();
      await gateway.handleMessage(socket, { slug: 'abc', content: 123 } as any);
      expect(mocks.moderationService.isUserSuspended).not.toHaveBeenCalled();
    });

    it('ignora quando o slug não é string', async () => {
      const socket = authedSocket();
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      await gateway.handleMessage(socket, { slug: null, content: 'oi' } as any);
      expect(mocks.roomService.getRoomBySlug).not.toHaveBeenCalled();
    });

    it('emite erro quando usuário está suspenso', async () => {
      const socket = authedSocket();
      mocks.moderationService.isUserSuspended.mockResolvedValue(true);
      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });
      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Sua conta está suspensa.',
      });
    });

    it('emite rateLimited quando excede o limite de mensagens', async () => {
      const socket = authedSocket();
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      (gateway as any).messageTimestamps.set(
        'user-1',
        Array(15).fill(Date.now()),
      );
      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });
      expect(socket.emit).toHaveBeenCalledWith('rateLimited', {
        message: 'Muitas mensagens. Aguarde um momento.',
      });
    });

    it('ignora mensagem em branco', async () => {
      const socket = authedSocket();
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      await gateway.handleMessage(socket, { slug: 'abc', content: '   ' });
      expect(mocks.roomService.getRoomBySlug).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('emite duplicate para mensagem repetida', async () => {
      const socket = authedSocket();
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      (gateway as any).lastMessage.set('user-1', {
        content: 'oi',
        time: Date.now(),
      });
      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });
      expect(socket.emit).toHaveBeenCalledWith('duplicate', {
        message: 'Mensagem duplicada.',
      });
    });

    it('envia mensagem com sucesso para a sala', async () => {
      const socket = authedSocket({ rooms: new Set(['room:r1']) });
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      mocks.roomService.getRoomBySlug.mockResolvedValue(
        makeRoom({ creatorId: 'creator-1' }),
      );
      const message = {
        id: 'm1',
        content: 'oi',
        user: { id: 'user-1', name: 'Alice' },
      };
      mocks.roomService.createMessage.mockResolvedValue(message);
      mocks.roomService.touchActivity.mockResolvedValue(undefined);

      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });

      expect(mocks.roomService.createMessage).toHaveBeenCalledWith(
        'r1',
        'user-1',
        'oi',
      );
      expect(mocks.roomService.touchActivity).toHaveBeenCalledWith('r1');
      expect(server.to).toHaveBeenCalledWith('room:r1');
      expect(server.emit).toHaveBeenCalledWith('newMessage', message);
    });

    it('não envia quando o cliente não está na sala', async () => {
      const socket = authedSocket();
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      mocks.roomService.getRoomBySlug.mockResolvedValue(makeRoom());
      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });
      expect(mocks.roomService.createMessage).not.toHaveBeenCalled();
    });

    it('não faz broadcast quando createMessage retorna null', async () => {
      const socket = authedSocket({ rooms: new Set(['room:r1']) });
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      mocks.roomService.getRoomBySlug.mockResolvedValue(makeRoom());
      mocks.roomService.createMessage.mockResolvedValue(null);
      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });
      expect(mocks.roomService.touchActivity).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('emite erro quando falha ao buscar a sala', async () => {
      const socket = authedSocket();
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      mocks.roomService.getRoomBySlug.mockRejectedValue(new Error('boom'));
      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });
      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Falha ao enviar mensagem.',
      });
    });

    it('emite erro quando touchActivity falha', async () => {
      const socket = authedSocket({ rooms: new Set(['room:r1']) });
      mocks.moderationService.isUserSuspended.mockResolvedValue(false);
      mocks.roomService.getRoomBySlug.mockResolvedValue(makeRoom());
      mocks.roomService.createMessage.mockResolvedValue({ id: 'm1' });
      mocks.roomService.touchActivity.mockRejectedValue(new Error('db'));
      await gateway.handleMessage(socket, { slug: 'abc', content: 'oi' });
      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Falha ao enviar mensagem.',
      });
    });
  });

  describe('handleLoadHistory', () => {
    it('ignora quando slug não é string', async () => {
      const socket = makeSocket();
      await gateway.handleLoadHistory(socket, { slug: null } as any);
      expect(mocks.roomService.getRoomBySlug).not.toHaveBeenCalled();
    });

    it('emite o histórico de mensagens', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1']) });
      mocks.roomService.getRoomBySlug.mockResolvedValue(makeRoom());
      const messages = [{ id: 'm1', content: 'oi' }];
      mocks.roomService.getMessages.mockResolvedValue(messages);
      await gateway.handleLoadHistory(socket, { slug: 'abc' });
      expect(mocks.roomService.getMessages).toHaveBeenCalledWith('r1');
      expect(socket.emit).toHaveBeenCalledWith('messageHistory', messages);
    });

    it('não emite quando o cliente não está na sala', async () => {
      const socket = makeSocket();
      mocks.roomService.getRoomBySlug.mockResolvedValue(makeRoom());
      await gateway.handleLoadHistory(socket, { slug: 'abc' });
      expect(mocks.roomService.getMessages).not.toHaveBeenCalled();
    });

    it('emite erro quando a sala não é encontrada', async () => {
      const socket = makeSocket();
      mocks.roomService.getRoomBySlug.mockRejectedValue(
        new Error('sala não encontrada'),
      );
      await gateway.handleLoadHistory(socket, { slug: 'abc' });
      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Sala não encontrada.',
      });
    });
  });

  describe('handlePlayerSync', () => {
    function authedSocket(overrides: Record<string, any> = {}) {
      const socket = makeSocket(overrides);
      (gateway as any).userMap.set(socket.id, 'user-1');
      return socket;
    }

    it('ignora usuário não autenticado', async () => {
      const socket = makeSocket();
      gateway.handlePlayerSync(socket, {
        slug: 'abc',
        currentTime: 10,
        isPlaying: true,
      });
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('ignora quando o slug não é string', async () => {
      const socket = authedSocket();
      gateway.handlePlayerSync(socket, {
        slug: null,
        currentTime: 10,
        isPlaying: true,
      } as any);
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('ignora dados de player inválidos', async () => {
      const socket = authedSocket();
      gateway.handlePlayerSync(socket, {
        slug: 'abc',
        currentTime: -1,
        isPlaying: true,
      });
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('ignora quando isPlaying não é booleano', async () => {
      const socket = authedSocket();
      gateway.handlePlayerSync(socket, {
        slug: 'abc',
        currentTime: 10,
        isPlaying: 'sim',
      } as any);
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('ignora quando o cliente não é membro da sala', async () => {
      const socket = authedSocket({ rooms: new Set(['room:r1']) });
      gateway.handlePlayerSync(socket, {
        slug: 'abc',
        currentTime: 10,
        isPlaying: true,
      });
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('ignora quando o cliente não é host', async () => {
      const socket = authedSocket({ rooms: new Set(['room:r1']) });
      addParticipant('r1', makeParticipant({ isHost: false }));
      gateway.handlePlayerSync(socket, {
        slug: 'abc',
        currentTime: 10,
        isPlaying: true,
      });
      expect(server.emit).not.toHaveBeenCalled();
      expect((gateway as any).playerState.has('r1')).toBe(false);
    });

    it('sincroniza o player quando o host envia estado', async () => {
      const socket = authedSocket({ rooms: new Set(['room:r1']) });
      addParticipant('r1', makeParticipant({ isHost: true }));
      gateway.handlePlayerSync(socket, {
        slug: 'abc',
        currentTime: 10,
        isPlaying: true,
      });
      expect((gateway as any).playerState.get('r1')).toEqual(
        expect.objectContaining({ currentTime: 10, isPlaying: true }),
      );
      expect(server.to).toHaveBeenCalledWith('room:r1');
      expect(server.emit).toHaveBeenCalledWith(
        'playerSync',
        expect.objectContaining({ isPlaying: true, origin: 'user-1' }),
      );
    });
  });

  describe('handleRequestSync', () => {
    it('ignora quando o slug não é string', async () => {
      const socket = makeSocket();
      gateway.handleRequestSync(socket, { slug: null } as any);
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('ignora quando o cliente não é membro ou não está na sala', async () => {
      const socket = makeSocket();
      gateway.handleRequestSync(socket, { slug: 'abc' });
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('envia playerSync quando existe estado salvo', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1']) });
      addParticipant('r1', makeParticipant());
      (gateway as any).playerState.set('r1', {
        currentTime: 5,
        isPlaying: true,
        updatedAt: Date.now() - 2000,
      });
      gateway.handleRequestSync(socket, { slug: 'abc' });
      expect(socket.emit).toHaveBeenCalledWith(
        'playerSync',
        expect.objectContaining({ isPlaying: true, origin: 'host' }),
      );
    });

    it('não envia quando não existe estado salvo', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1']) });
      addParticipant('r1', makeParticipant());
      gateway.handleRequestSync(socket, { slug: 'abc' });
      expect(socket.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleGetParticipants', () => {
    it('ignora quando o slug não é string', async () => {
      const socket = makeSocket();
      gateway.handleGetParticipants(socket, { slug: null } as any);
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('emite a lista de participantes únicos para o cliente', async () => {
      const socket = makeSocket({ rooms: new Set(['room:r1']) });
      addParticipant(
        'r1',
        makeParticipant({ socketId: 'sock1', userId: 'user-1', isHost: true }),
      );
      addParticipant(
        'r1',
        makeParticipant({ socketId: 'sock2', userId: 'user-2' }),
      );
      addParticipant('r1', makeParticipant({ socketId: 'sock3' }));
      gateway.handleGetParticipants(socket, { slug: 'abc' });
      const emitted = (socket.emit as jest.Mock).mock.calls.find(
        (call) => call[0] === 'participantList',
      )?.[1] as Array<Record<string, unknown>>;
      expect(emitted).toHaveLength(2);
      expect(emitted.map((p) => p.userId)).toEqual(['user-1', 'user-2']);
      expect(emitted[0]).toEqual(expect.objectContaining({ isHost: false }));
    });

    it('não emite quando o cliente não é membro da sala', async () => {
      const socket = makeSocket();
      gateway.handleGetParticipants(socket, { slug: 'abc' });
      expect(socket.emit).not.toHaveBeenCalled();
    });
  });
});
