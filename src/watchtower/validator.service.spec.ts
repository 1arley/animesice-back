import { Validator } from '@/watchtower/validator.service';

function makeMockPrisma(
  coverImage: string | null = 'https://img.test/cover.jpg',
) {
  return {
    anime: {
      findUnique: jest.fn(async () => ({ coverImage })),
    },
  };
}

describe('Validator', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let validator: Validator;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    prisma = makeMockPrisma();
    validator = new Validator(prisma as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('pickValid retorna primeira com probe OK (expire no futuro)', async () => {
    const future = Math.floor(Date.now() / 1000) + 7200;
    const url = `https://googlevideo.com/v.mp4?expire=${future}`;
    const result = await validator.pickValid(
      [{ videoUrl: url, sourceId: 'meusanimes' }],
      'anime-1',
    );
    expect(result).not.toBeNull();
    expect(result?.videoUrl).toBe(url);
    expect(typeof result?.thumbnailUrl).toBe('string');
  });

  it('pickValid faz fallback p/ capa do anime quando thumbnail ausente', async () => {
    const future = Math.floor(Date.now() / 1000) + 7200;
    const url = `https://googlevideo.com/v.mp4?expire=${future}`;
    const result = await validator.pickValid(
      [{ videoUrl: url, sourceId: 'meusanimes', thumbnailUrl: null }],
      'anime-1',
    );
    expect(result?.thumbnailUrl).toBe('https://img.test/cover.jpg');
    expect(prisma.anime.findUnique).toHaveBeenCalledTimes(1);
  });

  it('pickValid retorna null quando probe detecta URL morta (403)', async () => {
    global.fetch = jest.fn(async () => ({
      status: 403,
      body: { cancel: jest.fn() },
    })) as any;
    const url = 'https://cdn.test/dead.mp4';
    const result = await validator.pickValid(
      [{ videoUrl: url, sourceId: 'animefire' }],
      'anime-1',
    );
    expect(result).toBeNull();
  });

  it('pickValid pula candidato null e continua para próxima', async () => {
    const future = Math.floor(Date.now() / 1000) + 7200;
    const url2 = `https://googlevideo.com/v2.mp4?expire=${future}`;
    const result = await validator.pickValid(
      [
        { videoUrl: '', sourceId: 'animefire' },
        { videoUrl: url2, sourceId: 'meusanimes' },
      ],
      'anime-1',
    );
    expect(result?.videoUrl).toBe(url2);
  });

  it('pickValid trata array vazio', async () => {
    const result = await validator.pickValid([], 'anime-1');
    expect(result).toBeNull();
  });
});
