import { NotFoundException } from '@nestjs/common';
import { WatchHistoryService } from '@/watch-history/watch-history.service';
import { UpdateProgressDto } from '@/watch-history/dto/update-progress.dto';

function makePrisma() {
  const prisma: {
    anime: { findUnique: jest.Mock };
    episode: { findFirst: jest.Mock };
    watchHistory: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      deleteMany: jest.Mock;
    };
    watchReward: { findUnique: jest.Mock; upsert: jest.Mock };
    gachaEconomyVersion: { findFirst: jest.Mock };
    crystalEvent: { aggregate: jest.Mock };
    $transaction: jest.Mock;
  } = {
    anime: {
      findUnique: jest.fn(async () => null),
    },
    episode: {
      findFirst: jest.fn(async () => null),
    },
    watchHistory: {
      upsert: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    watchReward: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
    },
    gachaEconomyVersion: {
      findFirst: jest.fn(async () => ({ snapshot: {} })),
    },
    crystalEvent: {
      aggregate: jest.fn(async () => ({ _sum: { delta: null } })),
    },
    $transaction: jest.fn(),
  };
  // Suporta a forma callback (serializável) e a forma array (leitura).
  prisma.$transaction.mockImplementation((ops: unknown) =>
    typeof ops === 'function'
      ? (ops as (tx: unknown) => unknown)(prisma)
      : Promise.all(ops as Promise<unknown>[]),
  );
  return prisma;
}

function makeAccounting() {
  return { credit: jest.fn(async () => ({})) as jest.Mock };
}

describe('WatchHistoryService', () => {
  function build() {
    const prisma = makePrisma();
    const accounting = makeAccounting();
    const svc = new WatchHistoryService(prisma as never, accounting as never);
    return { svc, prisma, accounting };
  }

  /** Mock de rastro pré-existente (nossa âncora antifraude). */
  function existingReward(
    prisma: { watchReward: { findUnique: jest.Mock } },
    reward: object,
  ) {
    prisma.watchReward.findUnique.mockResolvedValue(reward);
  }

  function dailySum(
    prisma: { crystalEvent: { aggregate: jest.Mock } },
    sum: number | null,
  ) {
    prisma.crystalEvent.aggregate.mockResolvedValue({ _sum: { delta: sum } });
  }

  function creditCalls(accounting: { credit: jest.Mock }) {
    return accounting.credit.mock.calls.map(
      ([, , amount, , refId, reason]) => ({ amount, refId, reason }),
    );
  }

  describe('updateProgress', () => {
    const dto: UpdateProgressDto = { progress: 100, duration: 120 };

    it('deve criar o histórico quando não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 120 });
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'wh1' });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, dto);

      expect(result).toEqual({ id: 'wh1', watchCredited: 0 });
      const args = prisma.watchHistory.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        userId_episodeId: { userId: 'u1', episodeId: 'e1' },
      });
      expect(args.create).toEqual(
        expect.objectContaining({
          userId: 'u1',
          episodeId: 'e1',
          progress: 100,
          duration: 120,
          completed: false,
        }),
      );
    });

    it('deve marcar como completado quando progress/duration >= 0.9', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 100 });
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'wh1' });

      await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 90,
        duration: 100,
      });

      const args = prisma.watchHistory.upsert.mock.calls[0][0];
      expect(args.create.completed).toBe(true);
    });

    it('deve respeitar dto.completed explícito', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 100 });
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'wh1' });

      await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 10,
        duration: 100,
        completed: true,
      });

      const args = prisma.watchHistory.upsert.mock.calls[0][0];
      expect(args.create.completed).toBe(true);
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(
        svc.updateProgress('u1', 'nao-existe', 1, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar NotFoundException quando o episódio não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(
        svc.updateProgress('u1', 'anime-slug', 999, dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProgress: créditos por tempo assistido', () => {
    beforeAll(() => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000 * 1000);
    });
    afterAll(() => {
      jest.restoreAllMocks();
    });

    function ready(prisma: ReturnType<typeof makePrisma>) {
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 300 });
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'wh1' });
      dailySum(prisma, null);
    }

    const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

    it('primeiro POST cria o rastro sem creditar nada', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 100,
        duration: 300,
      });

      expect(result.watchCredited).toBe(0);
      expect(accounting.credit).not.toHaveBeenCalled();
      const args = prisma.watchReward.upsert.mock.calls[0][0];
      expect(args.create).toEqual(
        expect.objectContaining({
          userId: 'u1',
          episodeId: 'e1',
          paidSeconds: 0,
          credited: 0,
          completedRewarded: false,
          lastProgress: 100,
        }),
      );
    });

    it('15s de reprodução contínua após os blocos anteriores creditam o bloco', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      // 590s anteriores → 29 cristais convertidos e 19 creditados.
      existingReward(prisma, {
        paidSeconds: 590,
        credited: 19,
        completedRewarded: false,
        lastProgress: 100,
        lastAt: secondsAgo(15),
      });

      // 15s contínuos → paidSeconds 605 → due floor(30.25) = 30 → bloco de 11.
      // Duration 300 impede o bônus de conclusão no mesmo POST.
      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 115,
        duration: 300,
      });

      expect(result.watchCredited).toBe(11);
      expect(creditCalls(accounting)).toEqual([
        { amount: 11, refId: 'e1', reason: 'Tempo assistido' },
      ]);
      expect(prisma.watchReward.upsert.mock.calls[0][0].update).toEqual(
        expect.objectContaining({
          paidSeconds: 605,
          credited: { increment: 11 },
          lastProgress: 115,
        }),
      );
    });

    it('ganhos menores que o bloco (5) ficam pendentes sem creditar', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      existingReward(prisma, {
        paidSeconds: 605,
        credited: 29,
        completedRewarded: false,
        lastProgress: 100,
        lastAt: secondsAgo(15),
      });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 115,
        duration: 300,
      });

      expect(result.watchCredited).toBe(0);
      expect(accounting.credit).not.toHaveBeenCalled();
    });

    it('rewind não credita tempo', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      existingReward(prisma, {
        paidSeconds: 590,
        credited: 29,
        completedRewarded: false,
        lastProgress: 200,
        lastAt: secondsAgo(15),
      });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 150,
        duration: 300,
      });

      expect(result.watchCredited).toBe(0);
      expect(accounting.credit).not.toHaveBeenCalled();
      expect(prisma.watchReward.upsert.mock.calls[0][0].update).toEqual(
        expect.objectContaining({ paidSeconds: 590 }),
      );
    });

    it('pulo de progresso vale no máximo o relógio do intervalo', async () => {
      const { svc, prisma } = build();
      ready(prisma);
      existingReward(prisma, {
        paidSeconds: 0,
        credited: 0,
        completedRewarded: false,
        lastProgress: 100,
        lastAt: secondsAgo(15),
      });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 900,
        duration: 1000,
        completed: false,
      });

      // 900 - 100 = 800 s de "progresso", mas só 15s de relógio (+2 tolerância).
      expect(prisma.watchReward.upsert.mock.calls[0][0].update).toEqual(
        expect.objectContaining({ paidSeconds: 17 }),
      );
      expect(result.watchCredited).toBe(0);
    });

    it('gap maior que 5 minutos interrompe a sessão sem creditar', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      existingReward(prisma, {
        paidSeconds: 590,
        credited: 29,
        completedRewarded: false,
        lastProgress: 100,
        lastAt: secondsAgo(600),
      });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 500,
        duration: 300,
        completed: false,
      });

      expect(result.watchCredited).toBe(0);
      expect(accounting.credit).not.toHaveBeenCalled();
    });

    it('primeira linha dos 90% credita o bônus de episódio completo', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 100 });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 95,
        duration: 100,
      });

      expect(result.watchCredited).toBe(50);
      expect(creditCalls(accounting)).toEqual([
        { amount: 50, refId: 'complete:e1', reason: 'Episódio completo' },
      ]);
      expect(prisma.watchReward.upsert.mock.calls[0][0].update).toEqual(
        expect.objectContaining({ completedRewarded: true }),
      );
    });

    it('bônus de episódio completo não se repete', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 100 });
      existingReward(prisma, {
        paidSeconds: 605,
        credited: 30,
        completedRewarded: true,
        lastProgress: 90,
        lastAt: secondsAgo(15),
      });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 98,
        duration: 100,
      });

      expect(result.watchCredited).toBe(0);
      expect(accounting.credit).not.toHaveBeenCalled();
    });

    it('teto diário limita o crédito ao resto do dia', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      existingReward(prisma, {
        paidSeconds: 590,
        credited: 19,
        completedRewarded: false,
        lastProgress: 100,
        lastAt: secondsAgo(15),
      });
      dailySum(prisma, 897);

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 115,
        duration: 300,
      });

      expect(result.watchCredited).toBe(3);
      expect(creditCalls(accounting)).toEqual([
        { amount: 3, refId: 'e1', reason: 'Tempo assistido' },
      ]);
    });

    it('economia sem versão publicada não crê nada', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      prisma.gachaEconomyVersion.findFirst.mockResolvedValue(null);

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 115,
        duration: 300,
      });

      expect(result.watchCredited).toBe(0);
      expect(accounting.credit).not.toHaveBeenCalled();
    });

    it('rate 0 desliga o drip (o tempo segue contando, o crédito não sai)', async () => {
      const { svc, prisma, accounting } = build();
      ready(prisma);
      prisma.gachaEconomyVersion.findFirst.mockResolvedValue({
        snapshot: { watch_crystals_per_10min: 0 },
      });
      existingReward(prisma, {
        paidSeconds: 590,
        credited: 19,
        completedRewarded: false,
        lastProgress: 100,
        lastAt: secondsAgo(15),
      });

      const result = await svc.updateProgress('u1', 'anime-slug', 1, {
        progress: 115,
        duration: 300,
      });

      expect(result.watchCredited).toBe(0);
      expect(accounting.credit).not.toHaveBeenCalled();
      expect(prisma.watchReward.upsert.mock.calls[0][0].update).toEqual(
        expect.objectContaining({ paidSeconds: 605 }),
      );
    });
  });

  describe('getContinueWatching', () => {
    it('deve retornar itens em andamento mapeados', async () => {
      const { svc, prisma } = build();
      const histories = [
        {
          episodeId: 'e1',
          progress: 50,
          duration: 120,
          watchedAt: new Date(),
          completed: false,
          episode: {
            id: 'e1',
            number: 1,
            title: 'Episódio 1',
            thumbnailUrl: 'thumb.jpg',
            duration: 120,
            anime: { id: 'a1', title: 'Anime 1', genres: [] },
          },
        },
      ];
      prisma.watchHistory.findMany.mockResolvedValue(histories);

      const result = await svc.getContinueWatching('u1', 12);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          episodeId: 'e1',
          progress: 50,
          episode: expect.objectContaining({ id: 'e1', number: 1 }),
          anime: expect.objectContaining({ id: 'a1' }),
        }),
      );
    });

    it('deve retornar lista vazia quando não há histórico', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);

      const result = await svc.getContinueWatching('u1');

      expect(result).toEqual([]);
    });

    it('deve limitar limit ao máximo 50 e mínimo 1', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);

      await svc.getContinueWatching('u1', 999);
      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );

      await svc.getContinueWatching('u1', 0);
      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });

    it('deve filtrar apenas itens não completados', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);

      await svc.getContinueWatching('u1');

      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', completed: false },
          orderBy: { watchedAt: 'desc' },
        }),
      );
    });
  });

  describe('getHistory', () => {
    it('deve retornar histórico paginado', async () => {
      const { svc, prisma } = build();
      const histories = [
        {
          episodeId: 'e1',
          progress: 100,
          completed: true,
          watchedAt: new Date(),
          episode: {
            id: 'e1',
            number: 1,
            title: 'Episódio 1',
            anime: { id: 'a1', slug: 'anime-slug', title: 'Anime 1' },
          },
        },
      ];
      prisma.watchHistory.findMany.mockResolvedValue(histories);
      prisma.watchHistory.count.mockResolvedValue(1);

      const result = await svc.getHistory('u1', 1, 24);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 24,
        totalPages: 1,
      });
    });

    it('deve retornar meta com totalPages = 0 sem histórico', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);
      prisma.watchHistory.count.mockResolvedValue(0);

      const result = await svc.getHistory('u1');

      expect(result.data).toEqual([]);
      expect(result.meta.totalPages).toBe(0);
    });

    it('deve limitar page ao mínimo 1 e limit ao máximo 100', async () => {
      const { svc, prisma } = build();
      prisma.watchHistory.findMany.mockResolvedValue([]);
      prisma.watchHistory.count.mockResolvedValue(0);

      await svc.getHistory('u1', 0, 999);

      expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });
  });

  describe('deleteHistory', () => {
    it('deve remover o item do histórico', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'e1', duration: 120 });
      prisma.watchHistory.deleteMany.mockResolvedValue({ count: 1 });

      const result = await svc.deleteHistory('u1', 'anime-slug', 1);

      expect(result).toEqual({ message: 'Removido do histórico.' });
      expect(prisma.watchHistory.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', episodeId: 'e1' },
      });
    });

    it('deve lançar NotFoundException quando o anime não existe', async () => {
      const { svc } = build();

      await expect(svc.deleteHistory('u1', 'nao-existe', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar NotFoundException quando o episódio não existe', async () => {
      const { svc, prisma } = build();
      prisma.anime.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(svc.deleteHistory('u1', 'anime-slug', 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
