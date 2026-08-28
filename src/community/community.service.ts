import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FeedbackStatus } from '@prisma/client';
import {
  CreateAnimeRequestDto,
  CreateSiteFeedbackDto,
} from '@/community/dto/community.dto';

@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Anime Requests ---

  async createRequest(userId: string, dto: CreateAnimeRequestDto) {
    const existing = await this.prisma.animeRequest.findFirst({
      where: {
        title: { equals: dto.title, mode: 'insensitive' },
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException(
        'Este anime já foi solicitado. Vote na solicitação existente.',
      );
    }

    const request = await this.prisma.animeRequest.create({
      data: {
        userId,
        title: dto.title,
        alternativeTitle: dto.alternativeTitle,
        notes: dto.notes,
        votes: { create: { userId } },
      },
      include: {
        user: {
          select: { id: true, name: true, userName: true, avatar: true },
        },
        _count: { select: { votes: true } },
      },
    });

    await this.prisma.animeRequest.update({
      where: { id: request.id },
      data: { voteCount: 1 },
    });

    return { ...request, voteCount: 1, hasVoted: true };
  }

  async listRequests(page = 1, limit = 20, status?: string, userId?: string) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [requests, total] = await this.prisma.$transaction([
      this.prisma.animeRequest.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: [{ voteCount: 'desc' }, { createdAt: 'desc' }],
        include: {
          user: {
            select: { id: true, name: true, userName: true, avatar: true },
          },
          _count: { select: { votes: true } },
          votes: userId
            ? { where: { userId }, select: { userId: true } }
            : false,
        },
      }),
      this.prisma.animeRequest.count({ where }),
    ]);

    return {
      data: requests.map((r) => ({
        ...r,
        hasVoted: userId ? r.votes?.length > 0 : false,
        votes: undefined,
      })),
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async voteRequest(requestId: string, userId: string) {
    const request = await this.prisma.animeRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true },
    });

    if (!request) {
      throw new NotFoundException('Solicitação não encontrada.');
    }

    const existingVote = await this.prisma.animeRequestVote.findUnique({
      where: {
        requestId_userId: { requestId, userId },
      },
    });

    if (existingVote) {
      await this.prisma.animeRequestVote.delete({
        where: { requestId_userId: { requestId, userId } },
      });
    } else {
      await this.prisma.animeRequestVote.create({
        data: { requestId, userId },
      });
    }

    // Atomic: recompute voteCount from actual rows to prevent drift.
    const voteCount = await this.prisma.animeRequestVote.count({
      where: { requestId },
    });
    await this.prisma.animeRequest.update({
      where: { id: requestId },
      data: { voteCount },
    });

    return { voted: !existingVote, voteCount };
  }

  async adminUpdateRequestStatus(
    requestId: string,
    status: FeedbackStatus,
    adminNote?: string,
  ) {
    const request = await this.prisma.animeRequest.findUnique({
      where: { id: requestId },
      select: { id: true },
    });

    if (!request) {
      throw new NotFoundException('Solicitação não encontrada.');
    }

    return this.prisma.animeRequest.update({
      where: { id: requestId },
      data: { status, adminNote },
      include: {
        user: {
          select: { id: true, name: true, userName: true, avatar: true },
        },
        _count: { select: { votes: true } },
      },
    });
  }

  // --- Site Feedback ---

  async createFeedback(userId: string, dto: CreateSiteFeedbackDto) {
    return this.prisma.siteFeedback.create({
      data: {
        userId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
      },
      include: {
        user: {
          select: { id: true, name: true, userName: true, avatar: true },
        },
      },
    });
  }

  async listFeedback(page = 1, limit = 20, type?: string, status?: string) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.siteFeedback.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: [{ upvotes: 'desc' }, { createdAt: 'desc' }],
        include: {
          user: {
            select: { id: true, name: true, userName: true, avatar: true },
          },
        },
      }),
      this.prisma.siteFeedback.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async upvoteFeedback(userId: string, feedbackId: string) {
    const feedback = await this.prisma.siteFeedback.findUnique({
      where: { id: feedbackId },
      select: { id: true },
    });

    if (!feedback) {
      throw new NotFoundException('Feedback não encontrado.');
    }

    const existing = await this.prisma.siteFeedbackUpvote.findUnique({
      where: {
        userId_feedbackId: { userId, feedbackId },
      },
    });

    if (existing) {
      await this.prisma.siteFeedbackUpvote.delete({
        where: {
          userId_feedbackId: { userId, feedbackId },
        },
      });
      await this.prisma.siteFeedback.update({
        where: { id: feedbackId },
        data: { upvotes: { decrement: 1 } },
      });
      return { upvoted: false };
    }

    await this.prisma.siteFeedbackUpvote.create({
      data: { userId, feedbackId },
    });
    await this.prisma.siteFeedback.update({
      where: { id: feedbackId },
      data: { upvotes: { increment: 1 } },
    });
    return { upvoted: true };
  }

  async adminUpdateFeedbackStatus(
    feedbackId: string,
    status: FeedbackStatus,
    adminNote?: string,
  ) {
    const feedback = await this.prisma.siteFeedback.findUnique({
      where: { id: feedbackId },
      select: { id: true },
    });

    if (!feedback) {
      throw new NotFoundException('Feedback não encontrado.');
    }

    return this.prisma.siteFeedback.update({
      where: { id: feedbackId },
      data: { status, adminNote },
      include: {
        user: {
          select: { id: true, name: true, userName: true, avatar: true },
        },
      },
    });
  }
}
