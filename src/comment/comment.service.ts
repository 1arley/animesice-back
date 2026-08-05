import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCommentDto } from '@/comment/dto/create-comment.dto';
import { DEFAULT_PAGE } from '@/common/constants';

const MAX_COMMENTS_PER_PAGE = 50;
const MAX_REPLIES_PER_COMMENT = 5;

/** Remove HTML/tags de conteúdo criado pelo usuário (anti-XSS). */
function sanitizeContent(content: string): string {
  return content.replace(/<[^>]*>/g, '').trim();
}

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

    const content = sanitizeContent(dto.content);
    if (!content) {
      throw new BadRequestException('Comentário vazio.');
    }

    return this.prisma.comment.create({
      data: {
        content,
        userId,
        animeId: dto.animeId ?? null,
        episodeId: dto.episodeId ?? null,
        parentId: dto.parentId ?? null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async findByAnime(
    animeId: string,
    page = DEFAULT_PAGE,
    limit = MAX_COMMENTS_PER_PAGE,
  ) {
    return this.findTopLevel({ animeId, parentId: null }, page, limit);
  }

  async findByEpisode(
    episodeId: string,
    page = DEFAULT_PAGE,
    limit = MAX_COMMENTS_PER_PAGE,
  ) {
    return this.findTopLevel({ episodeId, parentId: null }, page, limit);
  }

  private findTopLevel(
    where: {
      animeId?: string | null;
      episodeId?: string | null;
      parentId: null;
    },
    page: number,
    limit: number,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_COMMENTS_PER_PAGE);
    const safePage = Math.max(page, 1);
    return this.prisma.comment.findMany({
      where,
      take: safeLimit,
      skip: (safePage - 1) * safeLimit,
      include: {
        user: { select: { id: true, name: true } },
        replies: {
          take: MAX_REPLIES_PER_COMMENT,
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
