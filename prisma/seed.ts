import 'dotenv/config';
import { PrismaClient, AudioType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

function createPrismaClient(): PrismaClient {
  const provider = process.env.DATABASE_PROVIDER || 'postgresql';
  if (provider === 'sqlite') {
    const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL || '' });
    return new PrismaClient({ adapter });
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

const adminEmail = 'admin@example.com';
const userEmail = 'user@example.com';
const adminPasswordClear = 'Admin123!';
const userPasswordClear = 'User123!';

// --- Jikan (MyAnimeList public API) ---

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const JIKAN_PAGE_SIZE = 24;

interface JikanAnime {
  mal_id: number;
  title: string;
  title_english?: string | null;
  synopsis?: string | null;
  images: {
    jpg: { large_image_url: string };
    webp: { large_image_url: string };
  };
  score?: number | null;
  rating?: string | null;
  airing?: boolean | null;
  episodes?: number | null;
  duration?: string | null;
  genres?: Array<{ name: string }>;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function ageRatingFromMal(rating?: string | null): string {
  if (!rating) return 'A14';
  const r = rating.toUpperCase();
  if (r.includes('R-17') || r.includes('RX')) return 'A18';
  if (r.includes('R')) return 'A16';
  if (r.includes('PG-13') || r.includes('13')) return 'A14';
  if (r.includes('PG') || r.includes('CHILDREN') || r.includes('ALL')) return 'A10';
  return 'A14';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJikan<T = any>(path: string, retries = 8): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${JIKAN_BASE}${path}`);
    if (res.status === 200) {
      const json = (await res.json()) as { data: T };
      return json.data;
    }
    if (res.status === 429) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status >= 500) {
      await sleep(2500 * (attempt + 1));
      continue;
    }
    // 4xx (non-429): don't retry
    throw new Error(`Jikan ${path} -> ${res.status}`);
  }
  throw new Error(`Jikan ${path} excedeu tentativas`);
}

// Fallback offline (Jikan/MAL instável): capas em cdn.myanimelist.net.
const FALLBACK_ANIMES: JikanAnime[] = [
  {
    mal_id: 21,
    title: 'One Piece',
    synopsis:
      'Monkey D. Luffy e sua tripulação de piratas buscam o maior tesouro já conhecido, o "One Piece", para que Luffy se torne o Rei dos Piratas.',
    images: {
      jpg: {
        large_image_url: 'https://cdn.myanimelist.net/images/anime/1244/138851l.jpg',
      },
      webp: {
        large_image_url: 'https://cdn.myanimelist.net/images/anime/1244/138851l.webp',
      },
    },
    score: 8.73,
    rating: 'PG-13 - Teens 13 or older',
    airing: true,
    episodes: 1130,
    duration: '24 min',
    genres: [{ name: 'Action' }, { name: 'Adventure' }, { name: 'Fantasy' }],
  },
  {
    mal_id: 38000,
    title: 'Demon Slayer: Kimetsu no Yaiba',
    synopsis:
      'Após sua família ser massacrada por demônios, Tanjiro Kamado se torna um caçador de demônios para vingá-los e encontrar uma cura para sua irmã Nezuko, transformada em demônio.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1286/99889l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1286/99889l.webp' },
    },
    score: 8.54,
    rating: 'R - 17+ (violence & profanity)',
    airing: false,
    episodes: 26,
    duration: '23 min',
    genres: [{ name: 'Action' }, { name: 'Award Winning' }, { name: 'Fantasy' }],
  },
  {
    mal_id: 40748,
    title: 'Jujutsu Kaisen',
    synopsis:
      'Yuji Itadori entra em uma sociedade secreta de feiticeiros para matar uma maldição poderosa chamada Ryomen Sukuna.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1171/109222l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1171/109222l.webp' },
    },
    score: 8.63,
    rating: 'R - 17+ (violence & profanity)',
    airing: false,
    episodes: 24,
    duration: '23 min',
    genres: [{ name: 'Action' }, { name: 'Fantasy' }, { name: 'Shounen' }],
  },
  {
    mal_id: 50265,
    title: 'Spy x Family',
    synopsis:
      'Um espião monta uma família falsa para uma missão, sem saber que a esposa é uma assassina e a filha adotiva é uma telepatista.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1441/122795l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1441/122795l.webp' },
    },
    score: 8.54,
    rating: 'PG-13 - Teens 13 or older',
    airing: true,
    episodes: 25,
    duration: '24 min',
    genres: [{ name: 'Action' }, { name: 'Comedy' }, { name: 'Slice of Life' }],
  },
  {
    mal_id: 16498,
    title: 'Attack on Titan',
    synopsis:
      'A humanidade vive cercada por enormes muralhas para se proteger dos Titãs. Eren jura exterminá-los após sua cidade ser destruída.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/10/47347l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/10/47347l.webp' },
    },
    score: 8.54,
    rating: 'R - 17+ (violence & profanity)',
    airing: false,
    episodes: 25,
    duration: '24 min',
    genres: [{ name: 'Action' }, { name: 'Drama' }, { name: 'Fantasy' }],
  },
  {
    mal_id: 9253,
    title: 'Steins;Gate',
    synopsis:
      'Um grupo de amigos descobre acidentalmente como enviar mensagens ao passado, alterando o presente e chamando atenção de organizações perigosas.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1935/127974l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1935/127974l.webp' },
    },
    score: 8.84,
    rating: 'PG-13 - Teens 13 or older',
    airing: false,
    episodes: 24,
    duration: '24 min',
    genres: [{ name: 'Drama' }, { name: 'Sci-Fi' }, { name: 'Suspense' }],
  },
  {
    mal_id: 28977,
    title: 'Gintama°',
    synopsis:
      'Comédia samurai num Japão alternativo invadido por alienígenas, misturando paródias, ação e humor absurdo.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/3/72078l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/3/72078l.webp' },
    },
    score: 9.06,
    rating: 'PG-13 - Teens 13 or older',
    airing: false,
    episodes: 51,
    duration: '24 min',
    genres: [{ name: 'Action' }, { name: 'Comedy' }, { name: 'Sci-Fi' }],
  },
  {
    mal_id: 11061,
    title: 'Hunter x Hunter (2011)',
    synopsis:
      'Gon Freecss parte em busca do pai, um lendário Hunter, descobrindo um mundo de perigos e amigos ao tornar-se Hunter.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1337/99013l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1337/99013l.webp' },
    },
    score: 9.06,
    rating: 'PG-13 - Teens 13 or older',
    airing: false,
    episodes: 148,
    duration: '23 min',
    genres: [{ name: 'Action' }, { name: 'Adventure' }, { name: 'Fantasy' }],
  },
  {
    mal_id: 5114,
    title: 'Fullmetal Alchemist: Brotherhood',
    synopsis:
      'Dois irmãos alquimistas buscam a Pedra Filosofal para restaurar seus corpos após uma transmutação proibida.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1223/96541l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1223/96541l.webp' },
    },
    score: 9.1,
    rating: 'PG-13 - Teens 13 or older',
    airing: false,
    episodes: 64,
    duration: '24 min',
    genres: [{ name: 'Action' }, { name: 'Adventure' }, { name: 'Drama' }],
  },
  {
    mal_id: 31964,
    title: 'My Hero Academia',
    synopsis:
      'Izuku Midoriya, sem poderes num mundo onde quase todos têm, herda o poder do maior herói e entra na escola de heróis.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/10/78645l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/10/78645l.webp' },
    },
    score: 7.92,
    rating: 'PG-13 - Teens 13 or older',
    airing: false,
    episodes: 13,
    duration: '24 min',
    genres: [{ name: 'Action' }, { name: 'School' }, { name: 'Shounen' }],
  },
  {
    mal_id: 20,
    title: 'Naruto',
    synopsis:
      'Naruto Uzumaki, jovem ninja com a Kyuubi selada, almeja tornar-se Hokage e ser reconhecido por sua vila.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/13/17405l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/13/17405l.webp' },
    },
    score: 7.98,
    rating: 'PG-13 - Teens 13 or older',
    airing: false,
    episodes: 220,
    duration: '23 min',
    genres: [{ name: 'Action' }, { name: 'Adventure' }, { name: 'Shounen' }],
  },
  {
    mal_id: 39535,
    title: 'Mob Psycho 100 III',
    synopsis:
      'Shigeo "Mob" Kageyama equilibra a vida adolescente e seus imensos poderes psíquicos enquanto enfrenta ameaças crescentes.',
    images: {
      jpg: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1170/127377l.jpg' },
      webp: { large_image_url: 'https://cdn.myanimelist.net/images/anime/1170/127377l.webp' },
    },
    score: 8.71,
    rating: 'PG-13 - Teens 13 or older',
    airing: false,
    episodes: 12,
    duration: '24 min',
    genres: [{ name: 'Action' }, { name: 'Comedy' }, { name: 'Supernatural' }],
  },
];

async function fetchTopAnimes(limit: number): Promise<JikanAnime[]> {
  try {
    const out: JikanAnime[] = [];
    let page = 1;
    while (out.length < limit) {
      const batch: JikanAnime[] = await fetchJikan<JikanAnime[]>(
        `/top/animes?page=${page}&limit=${JIKAN_PAGE_SIZE}&filter=airing`,
      );
      if (!batch.length) break;
      out.push(...batch);
      if (batch.length < JIKAN_PAGE_SIZE) break;
      page++;
      await sleep(1100); // Jikan free ~3 req/s; keep conservative
    }
    return out.slice(0, limit);
  } catch (e) {
    console.warn('Jikan indisponível, usando fallback offline:', (e as Error).message);
    return FALLBACK_ANIMES.slice(0, limit);
  }
}

async function upsertUser(
  email: string,
  passwordClear: string,
  name: string,
  role: string,
) {
  const password = await bcrypt.hash(passwordClear, 10);
  return prisma.user.upsert({
    where: { email },
    update: { password, name, role },
    create: { email, password, name, role },
  });
}

async function upsertGenreByMalName(
  cache: Map<string, string>,
  name: string,
): Promise<string | null> {
  const slug = slugify(name);
  if (!slug) return null;
  const cached = cache.get(slug);
  if (cached) return cached;
  const record = await prisma.genre.upsert({
    where: { slug },
    update: { name },
    create: { slug, name },
  });
  cache.set(slug, record.id);
  return record.id;
}

const EPISODE_PLACEHOLDER_COUNT = 12;
const ANIMEFIRE_BASE = 'https://animefire.io';
const UA_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function main() {
  console.log('Buscando catálogo da Jikan (MyAnimeList)...');
  const target = parseInt(
    process.env.SEED_ANIME_COUNT || '12',
    10,
  );
  const jikanAnimes = await fetchTopAnimes(target);
  console.log(`Encontrados ${jikanAnimes.length} animes via Jikan.`);

  const admin = await upsertUser(
    adminEmail,
    adminPasswordClear,
    'Admin User',
    'ADMIN',
  );
  const regular = await upsertUser(
    userEmail,
    userPasswordClear,
    'Regular User',
    'USER',
  );

  const genreCache = new Map<string, string>();
  const slugCount = new Map<string, number>();
  const createdAtAnchor = new Date('2026-08-01T00:00:00Z');

  for (const [i, ja] of jikanAnimes.entries()) {
    let slug = slugify(ja.title_english || ja.title);
    if (!slug) slug = `anime-${ja.mal_id}`;

    // uniqueness
    const seen = slugCount.get(slug) ?? 0;
    slugCount.set(slug, seen + 1);
    if (seen > 0) slug = `${slug}-${seen + 1}`;

    const coverImage = ja.images.webp.large_image_url || ja.images.jpg.large_image_url;
    const bannerImage = ja.images.jpg.large_image_url || coverImage;
    const malEpCount = ja.episodes && ja.episodes > 0 ? ja.episodes : EPISODE_PLACEHOLDER_COUNT;
    const epCount = Math.min(malEpCount, EPISODE_PLACEHOLDER_COUNT);

    const genreIds: string[] = [];
    for (const g of ja.genres ?? []) {
      const id = await upsertGenreByMalName(genreCache, g.name);
      if (id) genreIds.push(id);
    }

    const created = new Date(createdAtAnchor);
    created.setMinutes(created.getMinutes() + i * 7);

    const animeRecord = await prisma.anime.upsert({
      where: { slug },
      update: {
        title: ja.title,
        synopsis: ja.synopsis ?? null,
        coverImage,
        bannerImage,
        rating: ja.score ?? 0,
        status: ja.airing ? 'LANCAMENTO' : 'FINALIZADO',
        audio: AudioType.LEGENDADO,
        ageRating: ageRatingFromMal(ja.rating),
        genres: { set: [] },
      },
      create: {
        slug,
        title: ja.title,
        synopsis: ja.synopsis ?? null,
        coverImage,
        bannerImage,
        rating: ja.score ?? 0,
        status: ja.airing ? 'LANCAMENTO' : 'FINALIZADO',
        audio: AudioType.LEGENDADO,
        ageRating: ageRatingFromMal(ja.rating),
        createdAt: created,
        genres: { connect: genreIds.map((id) => ({ id })) },
      },
    });

    let episodeAnchor = new Date(created);
    for (let n = 1; n <= epCount; n++) {
      episodeAnchor = new Date(episodeAnchor.getTime() + 60_000);
      await prisma.episode.upsert({
        where: { animeId_number: { animeId: animeRecord.id, number: n } },
        update: {
          title: `Episódio ${n}`,
          thumbnailUrl: coverImage,
          videoUrl: null,
          duration: ja.duration ?? null,
          dateModified: episodeAnchor,
        },
        create: {
          number: n,
          title: `Episódio ${n}`,
          thumbnailUrl: coverImage,
          videoUrl: null,
          duration: ja.duration ?? null,
          dateModified: episodeAnchor,
          animeId: animeRecord.id,
        },
      });
    }

    // Reconecta gêneros após update set:[]
    await prisma.anime.update({
      where: { id: animeRecord.id },
      data: { genres: { connect: genreIds.map((id) => ({ id })) } },
    });

    // Tenta vincular embedUrl do animefire para cada episódio (lazy extract no runtime)
    const afSlug = slug;
    for (let n = 1; n <= epCount; n++) {
      const embedUrl = `${ANIMEFIRE_BASE}/animes/${afSlug}/${n}`;
      try {
        await prisma.episode.update({
          where: { animeId_number: { animeId: animeRecord.id, number: n } },
          data: { embedUrl },
        });
      } catch {
        // ignore non-existent episodes
      }
    }

    console.log(`  ✓ ${ja.title} (${slug}) — ${epCount} eps`);
    await sleep(120); // light spacing within loop
  }

  // Comentários de exemplo -------------------------------------------------
  type CommentSeed = {
    slug: string;
    episodeNumber: number | null;
    authorEmail: string;
    content: string;
  };
  const firstSlug = slugCount.size ? Array.from(slugCount.keys())[0] ?? '' : '';
  const comments: CommentSeed[] = [
    {
      slug: firstSlug,
      episodeNumber: 1,
      authorEmail: adminEmail,
      content: 'Catálogo populado via Jikan. Cadastre o videoUrl dos episódios no /admin.',
    },
  ];
  for (const c of comments) {
    const anime = await prisma.anime.findUnique({
      where: { slug: c.slug },
      select: { id: true },
    });
    if (!anime) continue;
    const userId = c.authorEmail === adminEmail ? admin.id : regular.id;
    const episode = c.episodeNumber
      ? await prisma.episode.findUnique({
          where: { animeId_number: { animeId: anime.id, number: c.episodeNumber } },
          select: { id: true },
        })
      : null;
    await prisma.comment
      .create({
        data: {
          content: c.content,
          userId,
          animeId: anime.id,
          episodeId: episode?.id ?? null,
        },
      })
      .catch(() => {
        /* ignora duplicados em re-seeds */
      });
  }

  console.log('Database seeded com sucesso!');
  console.log(`Admin: ${adminEmail} / ${adminPasswordClear}`);
  console.log(`User: ${userEmail} / ${userPasswordClear}`);
  console.log(
    `Importados ${jikanAnimes.length} animes da Jikan com gêneros + episódios placeholder.`,
  );
}

main()
  .catch((e) => {
    console.error('Seeding falhou:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
