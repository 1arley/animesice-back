import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomService } from '@/room/room.service';
import { ModerationService } from '@/moderation/moderation.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';

const MAX_MESSAGES_PER_MINUTE = 15;
const MAX_MESSAGE_LENGTH = 500;
const DUPLICATE_WINDOW_MS = 3000;

interface RoomParticipant {
  roomSlug: string;
  userId: string;
  socketId: string;
  userName: string | null;
  name: string | null;
  avatar: string | null;
  isHost: boolean;
}

interface PlayerSyncState {
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number;
}

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  },
  namespace: '/room',
})
export class RoomGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private userMap = new Map<string, string>();
  private messageTimestamps = new Map<string, number[]>();
  private lastMessage = new Map<string, { content: string; time: number }>();
  private roomParticipants = new Map<string, Map<string, RoomParticipant>>();
  private playerState = new Map<string, PlayerSyncState>();

  constructor(
    private readonly roomService: RoomService,
    private readonly moderationService: ModerationService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync<{
        sub?: unknown;
      }>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      if (typeof payload.sub !== 'string') {
        client.disconnect();
        return;
      }

      const isSuspended = await this.moderationService.isUserSuspended(
        payload.sub,
      );
      if (isSuspended) {
        client.emit('suspended', {
          message: 'Sua conta está suspensa.',
        });
        client.disconnect();
        return;
      }

      this.userMap.set(client.id, payload.sub);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.userMap.get(client.id);
    this.userMap.delete(client.id);
    if (userId) {
      this.messageTimestamps.delete(userId);
      this.lastMessage.delete(userId);
    }
    // Socket.IO já pode ter esvaziado client.rooms quando o callback de
    // disconnect roda. A fonte confiável aqui é o nosso registro de presença.
    for (const [roomId, participants] of this.roomParticipants) {
      const participant = participants.get(client.id);
      if (!participant) continue;
      this.removeParticipant(roomId, client.id);
      this.pauseIfLastHostLeft(roomId, participant);
      this.broadcastParticipantList(roomId);
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { slug: string },
  ) {
    const userId = this.userMap.get(client.id);
    if (!userId || typeof data?.slug !== 'string') return;

    try {
      const room = await this.roomService.getRoomBySlug(data.slug);

      if (!client.rooms.has(`room:${room.id}`)) {
        const participants = this.roomParticipants.get(room.id);
        const uniqueUsers = new Set(
          Array.from(participants?.values() ?? []).map((item) => item.userId),
        );
        if (
          !uniqueUsers.has(userId) &&
          uniqueUsers.size >= room.maxParticipants
        ) {
          client.emit('roomFull', {
            message: 'Sala cheia.',
          });
          return;
        }
      }

      await client.join(`room:${room.id}`);

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, userName: true, avatar: true },
      });

      this.addParticipant(room.id, {
        roomSlug: room.slug,
        userId,
        socketId: client.id,
        userName: user?.userName ?? null,
        name: user?.name ?? null,
        avatar: user?.avatar ?? null,
        isHost: room.creatorId === userId,
      });

      if (room.creatorId === userId) {
        await this.roomService.touchActivity(room.id);
      }

      client.emit('joinedRoom', {
        roomId: room.id,
        slug: room.slug,
        animeSlug: room.animeSlug,
        episodeNumber: room.episodeNumber,
        isHost: room.creatorId === userId,
      });

      const player = this.playerState.get(room.id);
      if (player) {
        client.emit('playerSync', this.serializePlayerState(player, 'host'));
      }

      this.broadcastParticipantList(room.id);
    } catch {
      client.emit('error', { message: 'Sala não encontrada.' });
    }
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: { slug: string },
  ) {
    for (const room of client.rooms) {
      if (room.startsWith('room:')) {
        const roomId = room.slice(5);
        const participant = this.roomParticipants.get(roomId)?.get(client.id);
        this.removeParticipant(roomId, client.id);
        void client.leave(room);
        if (participant) this.pauseIfLastHostLeft(roomId, participant);
        this.broadcastParticipantList(roomId);
      }
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { slug: string; content: string },
  ) {
    const userId = this.userMap.get(client.id);
    if (!userId || typeof data?.content !== 'string') return;
    if (typeof data?.slug !== 'string') return;

    const isSuspended = await this.moderationService.isUserSuspended(userId);
    if (isSuspended) {
      client.emit('error', {
        message: 'Sua conta está suspensa.',
      });
      return;
    }

    if (!this.checkRateLimit(userId)) {
      client.emit('rateLimited', {
        message: 'Muitas mensagens. Aguarde um momento.',
      });
      return;
    }

    const trimmed = data.content.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!trimmed) return;

    if (this.isDuplicate(userId, trimmed)) {
      client.emit('duplicate', { message: 'Mensagem duplicada.' });
      return;
    }

    try {
      const room = await this.roomService.getRoomBySlug(data.slug);
      if (!client.rooms.has(`room:${room.id}`)) return;
      const message = await this.roomService.createMessage(
        room.id,
        userId,
        trimmed,
      );

      if (!message) return;

      await this.roomService.touchActivity(room.id);
      this.server.to(`room:${room.id}`).emit('newMessage', message);
    } catch {
      client.emit('error', { message: 'Falha ao enviar mensagem.' });
    }
  }

  @SubscribeMessage('loadHistory')
  async handleLoadHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { slug: string },
  ) {
    if (typeof data?.slug !== 'string') return;
    try {
      const room = await this.roomService.getRoomBySlug(data.slug);
      if (!client.rooms.has(`room:${room.id}`)) return;
      const messages = await this.roomService.getMessages(room.id);
      client.emit('messageHistory', messages);
    } catch {
      client.emit('error', { message: 'Sala não encontrada.' });
    }
  }

  @SubscribeMessage('playerSync')
  handlePlayerSync(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { slug: string; currentTime: number; isPlaying: boolean },
  ) {
    const userId = this.userMap.get(client.id);
    if (!userId || typeof data?.slug !== 'string') return;

    if (
      !Number.isFinite(data.currentTime) ||
      data.currentTime < 0 ||
      typeof data.isPlaying !== 'boolean'
    ) {
      return;
    }

    const membership = this.findMembership(client.id, data.slug);
    if (!membership) return;
    const { roomId, participant } = membership;
    const channel = `room:${roomId}`;
    if (!client.rooms.has(channel) || !participant?.isHost) return;

    const now = Date.now();
    this.playerState.set(roomId, {
      currentTime: data.currentTime,
      isPlaying: data.isPlaying,
      updatedAt: now,
    });

    this.server
      .to(channel)
      .emit(
        'playerSync',
        this.serializePlayerState(this.playerState.get(roomId)!, userId),
      );
  }

  @SubscribeMessage('requestSync')
  handleRequestSync(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { slug: string },
  ) {
    if (typeof data?.slug !== 'string') return;
    const membership = this.findMembership(client.id, data.slug);
    if (!membership || !client.rooms.has(`room:${membership.roomId}`)) return;
    const state = this.playerState.get(membership.roomId);
    if (state) {
      client.emit('playerSync', this.serializePlayerState(state, 'host'));
    }
  }

  @SubscribeMessage('getParticipants')
  handleGetParticipants(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { slug: string },
  ) {
    if (typeof data?.slug !== 'string') return;
    const membership = this.findMembership(client.id, data.slug);
    if (membership && client.rooms.has(`room:${membership.roomId}`)) {
      this.broadcastParticipantList(membership.roomId, client);
    }
  }

  private checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const timestamps = this.messageTimestamps.get(clientId) ?? [];
    const recent = timestamps.filter((t) => now - t < 60_000);
    if (recent.length >= MAX_MESSAGES_PER_MINUTE) {
      return false;
    }
    recent.push(now);
    this.messageTimestamps.set(clientId, recent);
    return true;
  }

  private isDuplicate(clientId: string, content: string): boolean {
    const last = this.lastMessage.get(clientId);
    const now = Date.now();
    if (
      last &&
      last.content === content &&
      now - last.time < DUPLICATE_WINDOW_MS
    ) {
      return true;
    }
    this.lastMessage.set(clientId, { content, time: now });
    return false;
  }

  private addParticipant(roomId: string, participant: RoomParticipant) {
    if (!this.roomParticipants.has(roomId)) {
      this.roomParticipants.set(roomId, new Map());
    }
    this.roomParticipants.get(roomId)!.set(participant.socketId, participant);
  }

  private findMembership(socketId: string, roomSlug: string) {
    for (const [roomId, participants] of this.roomParticipants) {
      const participant = participants.get(socketId);
      if (participant?.roomSlug === roomSlug) return { roomId, participant };
    }
    return null;
  }

  private removeParticipant(roomId: string, socketId: string) {
    this.roomParticipants.get(roomId)?.delete(socketId);
    if (this.roomParticipants.get(roomId)?.size === 0) {
      this.roomParticipants.delete(roomId);
      this.playerState.delete(roomId);
    }
  }

  private broadcastParticipantList(roomId: string, target?: Socket) {
    const participants = this.roomParticipants.get(roomId);
    const uniqueParticipants = new Map<string, RoomParticipant>();
    for (const participant of participants?.values() ?? []) {
      uniqueParticipants.set(participant.userId, participant);
    }
    const list = participants
      ? Array.from(uniqueParticipants.values()).map((p) => ({
          userId: p.userId,
          userName: p.userName,
          name: p.name,
          avatar: p.avatar,
          isHost: p.isHost,
        }))
      : [];

    const emit = target ?? this.server.to(`room:${roomId}`);
    emit.emit('participantList', list);
  }

  private serializePlayerState(state: PlayerSyncState, origin: string) {
    const elapsed = state.isPlaying
      ? Math.max(0, (Date.now() - state.updatedAt) / 1000)
      : 0;
    return {
      currentTime: state.currentTime + elapsed,
      isPlaying: state.isPlaying,
      origin,
    };
  }

  private pauseIfLastHostLeft(roomId: string, participant: RoomParticipant) {
    if (!participant.isHost) return;
    const hostStillConnected = Array.from(
      this.roomParticipants.get(roomId)?.values() ?? [],
    ).some((item) => item.isHost);
    if (hostStillConnected) return;

    const state = this.playerState.get(roomId);
    if (!state?.isPlaying) return;
    const pausedState: PlayerSyncState = {
      currentTime:
        state.currentTime + Math.max(0, (Date.now() - state.updatedAt) / 1000),
      isPlaying: false,
      updatedAt: Date.now(),
    };
    this.playerState.set(roomId, pausedState);
    this.server
      .to(`room:${roomId}`)
      .emit('playerSync', this.serializePlayerState(pausedState, 'host-left'));
  }

  private extractToken(client: Socket): string | null {
    const cookieHeader = client.handshake.headers.cookie;
    if (typeof cookieHeader === 'string') {
      const match = cookieHeader.match(/access_token=([^;]+)/);
      if (match) return match[1] ?? null;
    }
    const auth = client.handshake.auth;
    if (auth && typeof auth.token === 'string') return auth.token;
    return null;
  }
}
