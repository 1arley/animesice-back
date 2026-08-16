#!/usr/bin/env ts-node
/**
 * backfill-enrich-anilist.ts — enriquece o catálogo com dados do AniList:
 * sinopse, gêneros, título japonês, títulos alternativos, estúdios, nota,
 * datas e fonte. Alvo principal: os animes com sinopse-placeholder
 * ("Assistir <título> online") e/ou sem anilistId — o "conteúdo de baixo
 * valor" que derruba o AdSense.
 *
 * Passes:
 *   missing  animes sem anilistId  -> busca por título + enriquece tudo
 *   rich     animes com anilistId e sinopse curta/placeholder -> busca por id
 *   both     (padrão) missing + rich
 *
 * Idempotente e seguro p/ re-execução. NÃO sobrescreve conteúdo já rico
 * (sinopse longa, estúdios, gêneros etc. já preenchidos ficam como estão).
 *
 * Uso: ts-node scripts/backfill-enrich-anilist.ts [--pass both|missing|rich] [--limit N] [--dry]
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
/** AniList mantém ~90 req/min em rajada sustentada; 800ms = ~75/min. */
const SLEEP_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sinopse com menos que isso é considerada placeholder/régenero. */
const MIN_SYNOPSIS_LENGTH = 80;
/** Limiar de similaridade para o match por título (mesmo do backfill atual). */
const MATCH_THRESHOLD = 0.6;

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({ connectionString: process.env.DATABASE_URL || '' }),
  ),
});

interface AniListMedia {
  id: number;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  description?: string | null;
  coverImage?: { large?: string | null; extraLarge?: string | null } | null;
  bannerImage?: string | null;
  averageScore?: number | null;
  status?: string | null;
  genres?: (string | null)[] | null;
  isAdult?: boolean | null;
  season?: string | null;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  endDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  studios?: { nodes?: Array<{ name?: string | null; isAnimationStudio?: boolean | null }> | null } | null;
  source?: string | null;
  synonyms?: (string | null)[] | null;
}

function cleanHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-$/g, '')
      .replace(/-+/g, '') || 'genero'
  );
}

function similarity(a: string, b: string): number {
  const la = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lb = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!la || !lb) return 0;
  if (la === lb) return 1;
  if (la.includes(lb) || lb.includes(la)) return 0.85;
  const setA = new Set(la);
  const setB = new Set(lb);
  let inter = 0;
  for (const c of setA) if (setB.has(c)) inter++;
  return inter / Math.max(setA.size, setB.size);
}

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  description
  coverImage { large extraLarge }
  bannerImage
  averageScore
  status
  genres
  isAdult
  season
  seasonYear
  format
  episodes
  startDate { year month day }
  endDate { year month day }
  studios(isMain: true) { nodes { name isAnimationStudio } }
  source
  synonyms
`;

async function searchAniList(search: string): Promise<AniListMedia | null> {
  const body = JSON.stringify({
    query: `query ($search: String) {
      Page(perPage: 1) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
      }
    }`,
    variables: { search },
  });
  const res = await request(body);
  return res?.Page?.media?.[0] ?? null;
}

async function fetchAniList(id: number): Promise<AniListMedia | null> {
  const body = JSON.stringify({
    query: `query ($id: Int) {
      Media(id: $id) { ${MEDIA_FIELDS} }
    }`,
    variables: { id },
  });
  const res = await request(body);
  return res?.Media ?? null;
}

async function request(body: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
  } catch {
    return null;
  }
  if (res.status === 429) {
    console.warn('  ! 429 — aguardando 60s (rate limit)');
    await sleep(60_000);
    try {
      res = await fetch(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      });
    } catch {
      return null;
    }
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as any;
  } catch {
    return null;
  }
}

function isPlaceholderSynopsis(s: string | null | undefined): boolean {
  return !s || s.length < MIN_SYNOPSIS_LENGTH;
}

async function enrichAnime(
  anime: { id: string; slug: string; title: string; synopsis: string | null },
  media: AniListMedia,
  dry: boolean,
): Promise<boolean> {
  const title = media.title?.romaji || media.title?.english || media.title?.native || '';
  if (!title) {
    console.error(`  ? ${anime.slug} — AniList sem título`);
    return false;
  }

  const mediaTitle = `${media.title?.romaji ?? ''} ${media.title?.english ?? ''} ${media.title?.native ?? ''}`;
  const bestTitle = title;
  const score = Math.max(
    similarity(anime.title || anime.slug, bestTitle),
    similarity(anime.title || anime.slug, mediaTitle),
  );
  if (score < MATCH_THRESHOLD) {
    console.error(`  ! ${anime.slug} — ambíguo (${score.toFixed(2)}): AniList="${title}" id=${media.id}`);
    return false;
  }

  const studios = (media.studios?.nodes ?? [])
    .filter((s) => s.isAnimationStudio !== false)
    .map((s) => s.name)
    .filter((n): n is string => Boolean(n));

  const genreNames = (media.genres ?? []).filter((g): g is string => Boolean(g));
  const genreSlugs = [...new Set(genreNames.map(slugify).filter(Boolean))];

  const seasonMap: Record<string, string> = {
    WINTER: 'WINTER',
    SPRING: 'SPRING',
    SUMMER: 'SUMMER',
    FALL: 'FALL',
  };
  const formatMap: Record<string, string> = {
    TV: 'TV',
    MOVIE: 'MOVIE',
    OVA: 'OVA',
    ONA: 'ONA',
    SPECIAL: 'SPECIAL',
    MUSIC: 'MUSIC',
  };

  const altTitles = [
    media.title?.english,
    media.title?.native,
    ...(media.synonyms ?? []),
  ].filter(
    (t): t is string =>
      Boolean(t) && t !== title && t !== anime.title,
  );

  const releaseDate =
    media.startDate?.year
      ? new Date(
          media.startDate.year,
          (media.startDate.month ?? 1) - 1,
          media.startDate.day ?? 1,
        )
      : undefined;
  const endDate =
    media.endDate?.year
      ? new Date(
          media.endDate.year,
          (media.endDate.month ?? 1) - 1,
          media.endDate.day ?? 1,
        )
      : undefined;

  const animeScore =
    typeof media.averageScore === 'number' && media.averageScore > 0
      ? media.averageScore / 10
      : undefined;

  const newSynopsis =
    media.description && cleanHtml(media.description).length >= MIN_SYNOPSIS_LENGTH
      ? cleanHtml(media.description)
      : undefined;

  const data: Record<string, unknown> = {
    ...(isPlaceholderSynopsis(anime.synopsis) && newSynopsis
      ? { synopsis: newSynopsis }
      : {}),
    ...(genreSlugs.length ? { genres: { set: genreSlugs.map((g) => ({ slug: g })) } } : {}),
    ...(media.title?.native ? { japaneseTitle: media.title.native } : {}),
    ...(altTitles.length ? { alternativeTitles: altTitles } : {}),
    ...(studios.length ? { studios } : {}),
    ...(media.source ? { source: media.source } : {}),
    ...(animeScore !== undefined ? { rating: animeScore } : {}),
    ...(media.isAdult ? { ageRating: 'A18' } : {}),
    ...(media.seasonYear ? { year: media.seasonYear } : {}),
    ...(media.season && seasonMap[media.season] ? { season: seasonMap[media.season] } : {}),
    ...(media.format && formatMap[media.format] ? { format: formatMap[media.format] } : {}),
    ...(media.episodes ? { episodeCount: media.episodes } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    ...(endDate ? { endDate } : {}),
    anilistId: media.id,
  };

  // Gêneros faltantes precisam existir antes do connect/set.
  if (!dry && genreSlugs.length) {
    await Promise.all(
      genreSlugs.map((gSlug, i) =>
        prisma.genre.upsert({
          where: { slug: gSlug },
          update: {},
          create: { slug: gSlug, name: genreNames[i] || gSlug },
        }),
      ),
    );
  }

  if (!dry) {
    await prisma.anime.update({ where: { id: anime.id }, data: data as any });
  }
  console.log(
    `  ✓ ${anime.slug} -> AniList#${media.id} (` +
      (newSynopsis ? 'sinopse' : '') +
      (genreSlugs.length ? ' +gêneros' : '') +
      (media.title?.native ? ' +jp' : '') +
      (animeScore !== undefined ? ` +nota${animeScore.toFixed(1)}` : '') +
      ')',
  );
  return true;
}

async function runPassMissing(dry: boolean, limit: number): Promise<void> {
  const animes = await prisma.anime.findMany({
    where: { anilistId: null },
    select: { id: true, slug: true, title: true, synopsis: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  console.log(`\n[PASS missing] ${animes.length} animes sem anilistId`);

  let matched = 0;
  let ambiguous = 0;
  for (const anime of animes) {
    const queries = [
      anime.title || '',
      anime.slug.replace(/-/g, ' '),
    ].filter((q) => q.length >= 3);
    let media: AniListMedia | null = null;
    for (const q of queries) {
      media = await searchAniList(q);
      if (media && similarity(anime.title || anime.slug, media.title?.romaji || media.title?.english || '') >= MATCH_THRESHOLD) {
        break;
      }
    }
    await sleep(SLEEP_MS);

    if (!media) {
      console.error(`  ? ${anime.slug} — sem match no AniList`);
      continue;
    }
    if (await enrichAnime(anime, media, dry)) matched++;
    else ambiguous++;
  }
  console.log(`[PASS missing] ${matched} ok, ${ambiguous} ambíguos/sem match`);
}

async function runPassRich(dry: boolean, limit: number): Promise<void> {
  const animes = await prisma.anime.findMany({
    where: { anilistId: { not: null } },
    select: { id: true, slug: true, title: true, synopsis: true, anilistId: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  console.log(`\n[PASS rich] ${animes.length} animes com anilistId`);

  let enriched = 0;
  for (const anime of animes) {
    if (!isPlaceholderSynopsis(anime.synopsis)) {
      continue;
    }
    const media = await fetchAniList(anime.anilistId!);
    await sleep(SLEEP_MS);
    if (!media) {
      console.error(`  ? ${anime.slug} — fetch id=${anime.anilistId} falhou`);
      continue;
    }
    if (await enrichAnime(anime, media, dry)) enriched++;
  }
  console.log(`[PASS rich] ${enriched} enriquecidos`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[ENRICH] pass=${args.pass} limit=${args.limit} dry=${args.dry}`);

  if (args.pass === 'missing' || args.pass === 'both') {
    await runPassMissing(args.dry, args.limit);
  }
  if (args.pass === 'rich' || args.pass === 'both') {
    await runPassRich(args.dry, args.limit);
  }

  await prisma.$disconnect();
}

function parseArgs() {
  const args = { pass: 'both' as string, limit: 999999, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pass' || argv[i] === '-p') args.pass = argv[++i] || 'both';
    else if (argv[i] === '--limit' || argv[i] === '-l') args.limit = parseInt(argv[++i] || '', 10) || 999999;
    else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

main().catch((e) => {
  console.error('[ENRICH] Falhou:', e);
  process.exit(1);
});