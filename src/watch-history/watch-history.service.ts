import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateProgressDto } from '@/watch-history/dto/update-progress.dto';
import { CrystalAccountingService } from '@/gacha/crystal-accounting.service';
import { dayStart } from '@/gacha/economy/economy.rules';
import { economyConfig } from '@/gacha/economy/economy.config';

/** Drip em bloco para enxugar o ledger (1 bloco ≈ 100s de reprodução). */
const WATCH_CREDIT_CHUNK = 5;
/** Gap maior que isso interrompe a sessão: o delta da volta não é base de crédito. */
const WATCH_SESSION_GAP_SECONDS = 300;
/** Tolerância do delta sobre o relógio (buffer de rede entre POSTs). */
const WATCH_CLOCK_TOLERANCE_SECONDS = 2;

type CreditWatch = { credited: number };

@Injectable()
export class WatchHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crystalAccounting: CrystalAccountingService,
  ) {}

  private async findEpisode(animeId: string, episodeNumber: number) {
    return this.prisma.episode.findFirst({
      where: {
        animeId,
        number: episodeNumber,
      },
      orderBy: { season: 'asc' },
      select: { id: true, duration: true },
    });
  }

  async updateProgress(
    userId: string,
    animeSlug: string,
    episodeNumber: number,
    dto: UpdateProgressDto,
  ) {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.findEpisode(anime.id, episodeNumber);

    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    const completed =
      dto.completed ?? this.checkCompleted(dto.progress, dto.duration);

    const history = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.watchHistory.upsert({
          where: {
            userId_episodeId: { userId, episodeId: episode.id },
          },
          update: {
            progress: dto.progress,
            duration: dto.duration,
            completed,
            watchedAt: new Date(),
          },
          create: {
            userId,
            episodeId: episode.id,
            progress: dto.progress,
            duration: dto.duration,
            completed,
          },
        });
        const watch = await this.creditWatchProgress(
          tx,
          userId,
          episode.id,
          dto.progress,
          completed,
        );
        return { row, watch };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { ...history.row, watchCredited: history.watch.credited };
  }

  /**
   * Créditos por tempo assistido: só entra no contador o delta de progresso
   * limitado pelo delta de relógio entre POSTs (rewind/seek não vale cristal),
   * com teto diário por usuário. Espelha EconomyService.currentVersion para
   * não expor a API do gacha aqui.
   */
  private async creditWatchProgress(
    tx: Prisma.TransactionClient,
    userId: string,
    episodeId: string,
    progress: number,
    completed: boolean,
  ): Promise<CreditWatch> {
    const version = await tx.gachaEconomyVersion.findFirst({
      where: { activeFrom: { lte: new Date() } },
      orderBy: [{ activeFrom: 'desc' }, { version: 'desc' }],
    });
    if (!version) return { credited: 0 };
    const config = economyConfig(version.snapshot);
    const rate = config.watch_crystals_per_10min;
    const bonus = config.watch_crystals_complete_bonus;
    if (rate <= 0 && bonus <= 0) return { credited: 0 };

    const reward = await tx.watchReward.findUnique({
      where: { userId_episodeId: { userId, episodeId } },
    });
    const now = new Date(Date.now());
    let gain = 0;
    if (reward?.lastAt) {
      const wall = Math.floor((now.getTime() - reward.lastAt.getTime()) / 1000);
      if (wall >= 0 && wall <= WATCH_SESSION_GAP_SECONDS) {
        gain = Math.max(
          0,
          Math.min(
            progress - reward.lastProgress,
            wall + WATCH_CLOCK_TOLERANCE_SECONDS,
          ),
        );
      }
    }
    const paidSeconds = (reward?.paidSeconds ?? 0) + gain;
    const dripOwed = Math.max(
      0,
      Math.floor((paidSeconds * rate) / 600) - (reward?.credited ?? 0),
    );
    const bonusOwed =
      completed && !(reward?.completedRewarded ?? false) ? bonus : 0;

    const daily = await tx.crystalEvent.aggregate({
      where: {
        userId,
        type: 'WATCH',
        createdAt: { gte: dayStart(now) },
      },
      _sum: { delta: true },
    });
    const remaining = Math.max(
      0,
      config.watch_crystals_daily_cap - (daily._sum.delta ?? 0),
    );

    let dripCredited = 0;
    let bonusCredited = 0;
    if (dripOwed + bonusOwed > 0) {
      const clamped = Math.min(dripOwed + bonusOwed, remaining);
      bonusCredited = Math.min(bonusOwed, clamped);
      dripCredited =
        bonusOwed > 0
          ? Math.min(dripOwed, clamped - bonusCredited)
          : dripOwed >= WATCH_CREDIT_CHUNK
            ? Math.min(dripOwed, clamped)
            : 0;
    }

    await tx.watchReward.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: {
        userId,
        episodeId,
        paidSeconds,
        credited: dripCredited,
        completedRewarded: bonusOwed > 0,
        lastProgress: progress,
        lastAt: now,
      },
      update: {
        paidSeconds,
        credited: { increment: dripCredited },
        completedRewarded: bonusOwed > 0 ? true : undefined,
        lastProgress: progress,
        lastAt: now,
      },
    });

    if (dripCredited > 0) {
      await this.crystalAccounting.credit(
        tx,
        userId,
        dripCredited,
        'WATCH',
        episodeId,
        'Tempo assistido',
      );
    }
    if (bonusCredited > 0) {
      await this.crystalAccounting.credit(
        tx,
        userId,
        bonusCredited,
        'WATCH',
        `complete:${episodeId}`,
        'Episódio completo',
      );
    }
    return { credited: dripCredited + bonusCredited };
  }

  async getContinueWatching(userId: string, limit = 12) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    const histories = await this.prisma.watchHistory.findMany({
      where: {
        userId,
        completed: false,
      },
      orderBy: { watchedAt: 'desc' },
      take: safeLimit,
      include: {
        episode: {
          include: {
            anime: { include: { genres: true } },
          },
        },
      },
    });

    return histories.map((h) => ({
      episodeId: h.episodeId,
      progress: h.progress,
      duration: h.duration,
      watchedAt: h.watchedAt,
      completed: h.completed,
      episode: {
        id: h.episode.id,
        number: h.episode.number,
        title: h.episode.title,
        thumbnailUrl: h.episode.thumbnailUrl,
        duration: h.episode.duration,
      },
      anime: h.episode.anime,
    }));
  }

  async getHistory(userId: string, page = 1, limit = 24) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const [histories, total] = await this.prisma.$transaction([
      this.prisma.watchHistory.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { watchedAt: 'desc' },
        include: {
          episode: {
            include: {
              anime: {
                select: { id: true, slug: true, title: true, coverImage: true },
              },
            },
          },
        },
      }),
      this.prisma.watchHistory.count({ where: { userId } }),
    ]);

    return {
      data: histories.map((h) => ({
        episodeId: h.episodeId,
        progress: h.progress,
        completed: h.completed,
        watchedAt: h.watchedAt,
        episode: {
          id: h.episode.id,
          number: h.episode.number,
          title: h.episode.title,
        },
        anime: h.episode.anime,
      })),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async deleteHistory(
    userId: string,
    animeSlug: string,
    episodeNumber: number,
  ): Promise<{ message: string }> {
    const anime = await this.prisma.anime.findUnique({
      where: { slug: animeSlug },
      select: { id: true },
    });

    if (!anime) {
      throw new NotFoundException('Anime não encontrado.');
    }

    const episode = await this.findEpisode(anime.id, episodeNumber);

    if (!episode) {
      throw new NotFoundException('Episódio não encontrado.');
    }

    await this.prisma.watchHistory.deleteMany({
      where: {
        userId,
        episodeId: episode.id,
      },
    });

    return { message: 'Removido do histórico.' };
  }

  private checkCompleted(progress: number, duration?: number): boolean {
    if (!duration || duration <= 0) return false;
    return progress / duration >= 0.9;
  }
}
