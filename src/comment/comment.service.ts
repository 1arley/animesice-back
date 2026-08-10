import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import {
  CreateCommentDto,
  EditCommentDto,
} from '@/comment/dto/create-comment.dto';
import { DEFAULT_PAGE } from '@/common/constants';

const MAX_COMMENTS_PER_PAGE = 50;
const MAX_REPLIES_PER_COMMENT = 5;

/** Remove todas as tags HTML/scripts de conteúdo criado pelo usuário (anti-XSS robusto). */
function sanitizeContent(content: string): string {
  return sanitizeHtml(content, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  }).trim();
}

@Injectable()
export class CommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

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

    return this.prisma.comment
      .create({
        data: {
          content,
          userId,
          animeId: dto.animeId ?? null,
          episodeId: dto.episodeId ?? null,
          parentId: dto.parentId ?? null,
        },
        include: {
          user: {
            select: { id: true, name: true, userName: true, avatar: true },
          },
          _count: { select: { likes: true } },
        },
      })
      .then(async (comment) => {
        if (dto.parentId) {
          const author = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });
          const parent = await this.prisma.comment.findUnique({
            where: { id: dto.parentId },
            select: { animeId: true },
          });
          const animeSlug = parent?.animeId
            ? (
                await this.prisma.anime.findUnique({
                  where: { id: parent.animeId },
                  select: { slug: true },
                })
              )?.slug
            : undefined;
          void this.notificationService.notifyCommentReply(
            dto.parentId,
            author?.name ?? 'Alguém',
            animeSlug,
          );
        }
        return comment;
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
        user: {
          select: { id: true, name: true, userName: true, avatar: true },
        },
        replies: {
          take: MAX_REPLIES_PER_COMMENT,
          include: {
            user: {
              select: { id: true, name: true, userName: true, avatar: true },
            },
            _count: { select: { likes: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { likes: true, replies: true } },
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

  async edit(userId: string, commentId: string, dto: EditCommentDto) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true },
    });

    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException('Você não pode editar este comentário.');
    }

    const content = sanitizeContent(dto.content);
    if (!content) {
      throw new BadRequestException('Comentário vazio.');
    }

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content, edited: true },
      include: {
        user: {
          select: { id: true, name: true, userName: true, avatar: true },
        },
        _count: { select: { likes: true } },
      },
    });
  }

  async toggleLike(userId: string, commentId: string) {
    const existingComment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true },
    });

    if (!existingComment) {
      throw new NotFoundException('Comentário não encontrado.');
    }

    const existing = await this.prisma.commentLike.findUnique({
      where: {
        userId_commentId: { userId, commentId },
      },
    });

    if (existing) {
      await this.prisma.commentLike.delete({
        where: { userId_commentId: { userId, commentId } },
      });
      return { liked: false };
    }

    await this.prisma.commentLike.create({
      data: { userId, commentId },
    });

    const liker = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const likedComment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { animeId: true },
    });
    const animeSlug = likedComment?.animeId
      ? (
          await this.prisma.anime.findUnique({
            where: { id: likedComment.animeId },
            select: { slug: true },
          })
        )?.slug
      : undefined;
    void this.notificationService.notifyCommentLike(
      commentId,
      liker?.name ?? 'Alguém',
      animeSlug,
    );

    return { liked: true };
  }

  async findReplies(
    commentId: string,
    page = DEFAULT_PAGE,
    limit = MAX_COMMENTS_PER_PAGE,
  ) {
    const parent = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true },
    });

    if (!parent) {
      throw new NotFoundException('Comentário não encontrado.');
    }

    const safeLimit = Math.min(Math.max(limit, 1), MAX_COMMENTS_PER_PAGE);
    const safePage = Math.max(page, 1);

    const [replies, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where: { parentId: commentId },
        take: safeLimit,
        skip: (safePage - 1) * safeLimit,
        include: {
          user: {
            select: { id: true, name: true, userName: true, avatar: true },
          },
          _count: { select: { likes: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.comment.count({ where: { parentId: commentId } }),
    ]);

    return {
      data: replies,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }
}
