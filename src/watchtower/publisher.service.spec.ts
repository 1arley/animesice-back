import { Publisher } from '@/watchtower/publisher.service';

function makeMocks() {
  const existingEpisode = new Map<string, boolean>();
  const episodeStore = new Map<string, any>();
  const animeStore = new Map<string, any>();

  return {
    existingEpisode,
    episodeStore,
    animeStore,
    prisma: {
      episode: {
        findUnique: jest.fn(async (args: any) =>
          existingEpisode.get(
            `${args.where.animeId_number.animeId}:${args.where.animeId_number.number}`,
          )
            ? { id: 'ep-exists' }
            : null,
        ),
        upsert: jest.fn(async (args: any) => {
          const key = `${args.where.animeId_number.animeId}:${args.where.animeId_number.number}`;
          const row = {
            id: 'ep-' + key,
            animeId: args.where.animeId_number.animeId,
            number: args.where.animeId_number.number,
            ...args.create,
            ...args.update,
          };
          episodeStore.set(key, row);
          return row;
        }),
        update: jest.fn(
          async (args: any) =>
            episodeStore.get(args.where.id) ?? { id: args.where.id },
        ),
      },
      anime: {
        findUnique: jest.fn(
          async (args: any) =>
            animeStore.get(args.where.id) ??
            animeStore.get(args.where.slug) ??
            null,
        ),
        update: jest.fn(async (args: any) => ({
          id: args.where.id,
          ...args.data,
        })),
      },
    },
    notifications: {
      notifyNewEpisode: jest.fn(async () => [{ id: 'n1' }]),
    },
  };
}

describe('Publisher', () => {
  let m: ReturnType<typeof makeMocks>;
  let pub: Publisher;

  beforeEach(() => {
    m = makeMocks();
    pub = new Publisher(m.prisma as any, m.notifications as any);
  });

  it('publish cria novo episódio quando não existe', async () => {
    m.animeStore.set('anime-1', { slug: 'solo', title: 'Solo Leveling' });
    await pub.publish({
      animeId: 'anime-1',
      episodeNumber: 1,
      videoUrl: 'https://v.test/1.mp4',
      embedUrl: 'https://meusanimes.blog/e/solo-1-episodio-1/',
      sourceId: 'meusanimes',
      title: 'Episódio 1',
      thumbnailUrl: 'https://img.test/t1.jpg',
    });
    expect(m.prisma.episode.upsert).toHaveBeenCalledTimes(1);
    const row = m.episodeStore.get('anime-1:1');
    expect(row).toBeDefined();
    expect(row.videoUrl).toContain('v.test');
    expect(row.sourceId).toBe('meusanimes');
    expect(row.videoBroken).toBe(false);
  });

  it('publish dispara notificação NEW_EPISODE apenas para episódios novos', async () => {
    m.animeStore.set('anime-1', { slug: 'solo', title: 'Solo Leveling' });
    await pub.publish({
      animeId: 'anime-1',
      episodeNumber: 2,
      videoUrl: 'https://v.test/2.mp4',
      embedUrl: 'embed2',
      sourceId: 'meusanimes',
    });
    expect(m.notifications.notifyNewEpisode).toHaveBeenCalledTimes(1);
  });

  it('publish não notifica quando episódio já existe', async () => {
    m.animeStore.set('anime-1', { slug: 'solo', title: 'Solo Leveling' });
    m.existingEpisode.set('anime-1:1', true);
    await pub.publish({
      animeId: 'anime-1',
      episodeNumber: 1,
      videoUrl: 'https://v.test/1.mp4',
      embedUrl: 'embed',
      sourceId: 'meusanimes',
    });
    expect(m.notifications.notifyNewEpisode).not.toHaveBeenCalled();
  });

  it('publish atualiza episódio existente (videoUrl/sourceId)', async () => {
    m.animeStore.set('anime-1', { slug: 'solo', title: 'Solo' });
    m.existingEpisode.set('anime-1:1', true);
    m.episodeStore.set('anime-1:1', {
      id: 'ep-exists',
      animeId: 'anime-1',
      number: 1,
      videoUrl: 'old',
    });
    await pub.publish({
      animeId: 'anime-1',
      episodeNumber: 1,
      videoUrl: 'https://new.test/1.mp4',
      embedUrl: 'embed-new',
      sourceId: 'animefire',
    });
    const row = m.episodeStore.get('anime-1:1');
    expect(row.videoUrl).toContain('new.test');
    expect(row.sourceId).toBe('animefire');
    expect(row.videoBroken).toBe(false);
  });

  it('markAnimeComplete atualiza status anime', async () => {
    await pub.markAnimeComplete('anime-1');
    expect(m.prisma.anime.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'anime-1' },
        data: { status: 'COMPLETO' },
      }),
    );
  });

  it('publish usa título default quando ausente', async () => {
    m.animeStore.set('anime-1', { slug: 'solo', title: 'Solo' });
    await pub.publish({
      animeId: 'anime-1',
      episodeNumber: 5,
      videoUrl: 'https://v.test/5.mp4',
      embedUrl: 'embed5',
      sourceId: 'meusanimes',
    });
    const row = m.episodeStore.get('anime-1:5');
    expect(row.title).toBe('Episódio 5');
  });
});
