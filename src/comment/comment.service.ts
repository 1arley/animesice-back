import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCommentDto } from '@/comment/dto/create-comment.dto';

@Injectable()
export class CommentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateCommentDto) {
    if (dto.animeId) {
      const anime = await this.prisma.anime.findUnique({
        where: { id: dto.animeId },
        select: { id: true },
      });
      if (!anime) {
        throw new NotFoundException('Anime não encontrado.');
      }
    }

    if (dto.episodeId) {
      const episode = await this.prisma.episode.findUnique({
        where: { id: dto.episodeId },
        select: { id: true },
      });
      if (!episode) {
        throw new NotFoundException('Episódio não encontrado.');
      }
    }

    if (dto.parentId) {
      const parent = await this.prisma.comment.findUnique({
        where: { id: dto.parentId },
        select: { id: true },
      });
      if (!parent) {
        throw new NotFoundException('Comentário pai não encontrado.');
      }
    }

    return this.prisma.comment.create({
      data: {
        content: dto.content,
        userId,
        animeId: dto.animeId ?? null,
        episodeId: dto.episodeId ?? null,
        parentId: dto.parentId ?? null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async findByAnime(animeId: string) {
    return this.prisma.comment.findMany({
      where: { animeId, parentId: null },
      include: {
        user: { select: { id: true, name: true } },
        replies: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByEpisode(episodeId: string) {
    return this.prisma.comment.findMany({
      where: { episodeId, parentId: null },
      include: {
        user: { select: { id: true, name: true } },
        replies: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true },
    });

    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException('Você não pode deletar este comentário.');
    }

    return this.prisma.comment.delete({
      where: { id: commentId },
    });
  }
}
