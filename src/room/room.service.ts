import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { generateRoomSlug } from '@/room/room.utils';
import type { CreateRoomDto } from '@/room/dto/create-room.dto';

const DEFAULT_MAX_PARTICIPANTS = 20;
const ROOM_TTL_HOURS = 24;
const INACTIVITY_TTL_HOURS = 6;

@Injectable()
export class RoomService {
  constructor(private readonly prisma: PrismaService) {}

  async createRoom(userId: string, dto: CreateRoomDto) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: dto.animeSlug },
      select: { id: true, slug: true, title: true },
    });
    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.prisma.episode.findFirst({
      where: { animeId: anime.id, number: dto.episodeNumber },
      select: { id: true },
    });
    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    const slug = generateRoomSlug();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ROOM_TTL_HOURS);

    try {
      return await this.prisma.room.create({
        data: {
          slug,
          creatorId: userId,
          animeSlug: dto.animeSlug,
          episodeNumber: dto.episodeNumber,
          maxParticipants: dto.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS,
          expiresAt,
        },
        select: {
          id: true,
          slug: true,
          animeSlug: true,
          episodeNumber: true,
          maxParticipants: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    } catch (err) {
      // Colisão rara de slug — gera outro e tenta uma vez mais.
      if ((err as { code?: string })?.code === 'P2002') {
        return this.prisma.room.create({
          data: {
            slug: generateRoomSlug(),
            creatorId: userId,
            animeSlug: dto.animeSlug,
            episodeNumber: dto.episodeNumber,
            maxParticipants: dto.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS,
            expiresAt,
          },
          select: {
            id: true,
            slug: true,
            animeSlug: true,
            episodeNumber: true,
            maxParticipants: true,
            expiresAt: true,
            createdAt: true,
          },
        });
      }
      throw err;
    }
  }

  async getRoomBySlug(slug: string) {
    const room = await this.prisma.room.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        creatorId: true,
        animeSlug: true,
        episodeNumber: true,
        maxParticipants: true,
        expiresAt: true,
        lastActivityAt: true,
        createdAt: true,
      },
    });

    if (!room) {
      throw new NotFoundException('Sala não encontrada.');
    }

    if (room.expiresAt < new Date()) {
      throw new NotFoundException('Sala expirada.');
    }

    return room;
  }

  async getMessages(roomId: string, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    return this.prisma.roomMessage.findMany({
      where: { roomId },
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, userName: true, avatar: true },
        },
      },
    });
  }

  async createMessage(roomId: string, userId: string, content: string) {
    const trimmed = content.trim().slice(0, 500);
    if (!trimmed) return null;

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, expiresAt: true },
    });

    if (!room || room.expiresAt < new Date()) {
      throw new BadRequestException('Sala não encontrada ou expirada.');
    }

    return this.prisma.roomMessage.create({
      data: {
        roomId,
        userId,
        content: trimmed,
      },
      include: {
        user: {
          select: { id: true, name: true, userName: true, avatar: true },
        },
      },
    });
  }

  async touchActivity(roomId: string) {
    // Throttle: só grava se lastActivityAt está há >5min (evita write
    // amplification e impede keep-alive contínuo por joins repetidos).
    const cutoff = new Date(Date.now() - 5 * 60_000);
    await this.prisma.room.updateMany({
      where: { id: roomId, lastActivityAt: { lt: cutoff } },
      data: { lastActivityAt: new Date() },
    });
  }

  /** Contagem de participantes pelo histórico (fallback p/ cenários sem socket
   *  live disponível). O gateway usa conexões reais via fetchSockets(). */
  async getParticipantCount(roomId: string): Promise<number> {
    const count = await this.prisma.roomMessage.findMany({
      where: { roomId },
      distinct: ['userId'],
      select: { userId: true },
    });
    return count.length;
  }

  async deleteRoom(userId: string, roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, creatorId: true },
    });

    if (!room) {
      throw new NotFoundException('Sala não encontrada.');
    }

    if (room.creatorId !== userId) {
      throw new ForbiddenException('Apenas o criador pode deletar a sala.');
    }

    return this.prisma.room.delete({
      where: { id: roomId },
    });
  }

  async cleanupExpiredRooms() {
    const now = new Date();
    const inactivityCutoff = new Date();
    inactivityCutoff.setHours(
      inactivityCutoff.getHours() - INACTIVITY_TTL_HOURS,
    );

    const expired = await this.prisma.room.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          {
            expiresAt: { gt: now },
            lastActivityAt: { lt: inactivityCutoff },
          },
        ],
      },
    });

    return expired.count;
  }
}
