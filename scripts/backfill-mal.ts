#!/usr/bin/env ts-node
/**
 * backfill-mal.ts — enriquece o catálogo com dados do MyAnimeList (API v2):
 * malId, sinopse, nota, estúdios, gêneros, datas, contagem de episódios etc.
 *
 * Passes:
 *   missing  animes sem malId  -> busca por título + enriquece tudo
 *   rich     animes com malId e sinopse placeholder -> busca por id
 *   both     (padrão) missing + rich
 *
 * Idempotente e seguro p/ re-execução. NÃO sobrescreve conteúdo já rico.
 *
 * Uso: ts-node scripts/backfill-mal.ts [--pass both|missing|rich] [--limit N] [--dry]
 * Env: DATABASE_URL, MAL_CLIENT_ID
 */
import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const MAL = 'https://api.myanimelist.net/v2';
const SLEEP_MS = 1100;
const RETRIES = 3;
const MIN_SYNOPSIS_LENGTH = 80;
const MATCH_THRESHOLD = 0.6;

const malAgent = new Agent({ connect: { family: 4 } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function malHeaders(): Record<string, string> {
  if (!process.env.MAL_CLIENT_ID) {
    throw new Error(
      'MAL_CLIENT_ID ausente — registre o app em myanimelist.net/apiconfig',
    );
  }
  return { 'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID };
}

async function mal<T>(path: string): Promise<T | null> {
  const headers = malHeaders();
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await sleep(SLEEP_MS);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let res;
      try {
        res = await undiciFetch(`${MAL}${path}`, {
          signal: controller.signal,
          dispatcher: malAgent,
          headers,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 400 || res.status === 404) return null;
      console.warn(
        `[backfill:mal] ${path}: HTTP ${res.status} (tentativa ${attempt})`,
      );
    } catch (error) {
      console.warn(
        `[backfill:mal] ${path}: ${(error as Error).message} (tentativa ${attempt})`,
      );
    }
    await sleep(1000 * attempt);
  }
  return null;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const la = normalizeTitle(a);
  const lb = normalizeTitle(b);
  if (!la || !lb) return 0;
  if (la === lb) return 1;
  if (la.includes(lb) || lb.includes(la)) return 0.85;
  const setA = new Set(la);
  const setB = new Set(lb);
  let inter = 0;
  for (const c of setA) if (setB.has(c)) inter++;
  return inter / Math.max(setA.size, setB.size);
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

function parseDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !m[1] || !m[2] || !m[3]) return undefined;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

interface MalAnimeSearch {
  data: Array<{
    node: {
      id: number;
      title?: string | null;
      alternative_titles?: {
        en?: string | null;
        ja?: string | null;
        synonyms?: string[];
      } | null;
    };
  }>;
}

interface MalAnimeDetail {
  id: number;
  title?: string | null;
  synopsis?: string | null;
  mean?: number | null;
  status?: string | null;
  media_type?: string | null;
  num_episodes?: number | null;
  start_season?: { year?: number | null; season?: string | null } | null;
  start_date?: string | null;
  end_date?: string | null;
  rating?: string | null;
  source?: string | null;
  studios?: Array<{ id: number; name?: string | null }> | null;
  genres?: Array<{ id: number; name?: string | null }> | null;
  alternative_titles?: {
    en?: string | null;
    ja?: string | null;
    synonyms?: string[];
  } | null;
  main_picture?: { medium?: string | null; large?: string | null } | null;
}

const MAL_SEARCH_FIELDS = 'id,title,alternative_titles';

async function searchMal(title: string): Promise<MalAnimeSearch | null> {
  return mal<MalAnimeSearch>(
    `/anime?q=${encodeURIComponent(title)}&limit=5&fields=${MAL_SEARCH_FIELDS}`,
  );
}

async function fetchMal(id: number): Promise<MalAnimeDetail | null> {
  return mal<MalAnimeDetail>(
    `/anime/${id}?fields=synopsis,mean,status,studios,genres,num_episodes,start_season,start_date,end_date,alternative_titles,rating,media_type,source,main_picture`,
  );
}

function isPlaceholderSynopsis(s: string | null | undefined): boolean {
  return !s || s.length < MIN_SYNOPSIS_LENGTH;
}

function malStatusToDb(status: string | null | undefined): string {
  switch (status) {
    case 'currently_airing':
      return 'LANCAMENTO';
    case 'finished_airing':
      return 'FINALIZADO';
    case 'not_yet_aired':
      return 'EM_BREVE';
    default:
      return 'FINALIZADO';
  }
}

function malTypeToDb(mediaType: string | null | undefined): string | undefined {
  const map: Record<string, string> = {
    tv: 'TV',
    movie: 'MOVIE',
    ova: 'OVA',
    ona: 'ONA',
    special: 'SPECIAL',
    music: 'MUSIC',
  };
  return mediaType ? map[mediaType] : undefined;
}

function malSeasonToDb(season: string | null | undefined): string | undefined {
  const map: Record<string, string> = {
    winter: 'WINTER',
    spring: 'SPRING',
    summer: 'SUMMER',
    fall: 'FALL',
  };
  return season ? map[season] : undefined;
}

function malRatingToDb(rating: string | null | undefined): string {
  switch (rating) {
    case 'g':
    case 'pg':
      return 'A10';
    case 'pg_13':
      return 'A14';
    case 'r':
      return 'A16';
    case 'r+':
    case 'rx':
      return 'A18';
    default:
      return 'A14';
  }
}

function matchByTitle(
  anime: { title: string; slug: string },
  malTitle: string | null | undefined,
  altTitles: MalAnimeDetail['alternative_titles'],
): boolean {
  const candidates = [
    malTitle,
    altTitles?.en,
    altTitles?.ja,
    ...(altTitles?.synonyms ?? []),
  ].filter((t): t is string => Boolean(t));
  const score = Math.max(
    ...candidates.map((c) => similarity(anime.title || anime.slug, c)),
  );
  return score >= MATCH_THRESHOLD;
}

async function enrichAnime(
  anime: {
    id: string;
    slug: string;
    title: string;
    synopsis: string | null;
    malId: number | null;
  },
  detail: MalAnimeDetail,
  dry: boolean,
): Promise<boolean> {
  if (!matchByTitle(anime, detail.title, detail.alternative_titles)) {
    console.error(
      `  ! ${anime.slug} — ambíguo: MAL="${detail.title}" id=${detail.id}`,
    );
    return false;
  }

  const genreNames = (detail.genres ?? [])
    .map((g) => g.name)
    .filter((n): n is string => Boolean(n));
  const genreSlugs = [...new Set(genreNames.map(slugify).filter(Boolean))];

  const studios = (detail.studios ?? [])
    .map((s) => s.name)
    .filter((n): n is string => Boolean(n));

  const altTitles = [
    detail.alternative_titles?.en,
    detail.alternative_titles?.ja,
    ...(detail.alternative_titles?.synonyms ?? []),
  ].filter(
    (t): t is string => Boolean(t) && t !== detail.title && t !== anime.title,
  );

  const animeScore =
    typeof detail.mean === 'number' && detail.mean > 0
      ? detail.mean / 10
      : undefined;

  const newSynopsis =
    detail.synopsis && cleanHtml(detail.synopsis).length >= MIN_SYNOPSIS_LENGTH
      ? cleanHtml(detail.synopsis)
      : undefined;

  const data: Record<string, unknown> = {
    malId: detail.id,
    ...(isPlaceholderSynopsis(anime.synopsis) && newSynopsis
      ? { synopsis: newSynopsis }
      : {}),
    ...(genreSlugs.length
      ? { genres: { set: genreSlugs.map((g) => ({ slug: g })) } }
      : {}),
    ...(detail.alternative_titles?.ja
      ? { japaneseTitle: detail.alternative_titles.ja }
      : {}),
    ...(altTitles.length ? { alternativeTitles: altTitles } : {}),
    ...(studios.length ? { studios } : {}),
    ...(detail.source ? { source: detail.source } : {}),
    ...(animeScore !== undefined ? { rating: animeScore } : {}),
    ...(detail.rating ? { ageRating: malRatingToDb(detail.rating) } : {}),
    ...(detail.start_season?.year ? { year: detail.start_season.year } : {}),
    ...(detail.start_season?.season && malSeasonToDb(detail.start_season.season)
      ? { season: malSeasonToDb(detail.start_season.season) }
      : {}),
    ...(detail.media_type && malTypeToDb(detail.media_type)
      ? { format: malTypeToDb(detail.media_type) }
      : {}),
    ...(detail.num_episodes ? { episodeCount: detail.num_episodes } : {}),
    ...(detail.status ? { status: malStatusToDb(detail.status) } : {}),
    ...(parseDate(detail.start_date)
      ? { releaseDate: parseDate(detail.start_date) }
      : {}),
    ...(parseDate(detail.end_date)
      ? { endDate: parseDate(detail.end_date) }
      : {}),
  };

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
    `  ✓ ${anime.slug} -> MAL#${detail.id} (` +
      (newSynopsis ? 'sinopse' : '') +
      (genreSlugs.length ? ' +gêneros' : '') +
      (detail.alternative_titles?.ja ? ' +jp' : '') +
      (animeScore !== undefined ? ` +nota${animeScore.toFixed(1)}` : '') +
      ')',
  );
  return true;
}

async function runPassMissing(dry: boolean, limit: number): Promise<void> {
  const animes = await prisma.anime.findMany({
    where: { malId: null },
    select: { id: true, slug: true, title: true, synopsis: true, malId: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  console.log(`\n[PASS missing] ${animes.length} animes sem malId`);

  let matched = 0;
  let ambiguous = 0;
  for (const anime of animes) {
    const queries = [anime.title || '', anime.slug.replace(/-/g, ' ')].filter(
      (q) => q.length >= 3,
    );
    let detail: MalAnimeDetail | null = null;
    for (const q of queries) {
      const search = await searchMal(q);
      if (!search) continue;
      for (const hit of search.data) {
        if (matchByTitle(anime, hit.node.title, hit.node.alternative_titles)) {
          detail = await fetchMal(hit.node.id);
          if (detail) break;
        }
      }
      if (detail) break;
    }

    if (!detail) {
      console.error(`  ? ${anime.slug} — sem match no MAL`);
      continue;
    }
    if (await enrichAnime(anime, detail, dry)) matched++;
    else ambiguous++;
  }
  console.log(`[PASS missing] ${matched} ok, ${ambiguous} ambíguos/sem match`);
}

async function runPassRich(dry: boolean, limit: number): Promise<void> {
  const animes = await prisma.anime.findMany({
    where: { malId: { not: null } },
    select: {
      id: true,
      slug: true,
      title: true,
      synopsis: true,
      malId: true,
    },
    orderBy: { id: 'asc' },
    take: limit,
  });
  console.log(`\n[PASS rich] ${animes.length} animes com malId`);

  let enriched = 0;
  for (const anime of animes) {
    if (!isPlaceholderSynopsis(anime.synopsis)) continue;
    const detail = await fetchMal(anime.malId!);
    if (!detail) {
      console.error(`  ? ${anime.slug} — fetch id=${anime.malId} falhou`);
      continue;
    }
    if (await enrichAnime(anime, detail, dry)) enriched++;
  }
  console.log(`[PASS rich] ${enriched} enriquecidos`);
}

const prisma = createPrismaClient();

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `[ENRICH:MAL] pass=${args.pass} limit=${args.limit} dry=${args.dry}`,
  );

  try {
    if (args.pass === 'missing' || args.pass === 'both') {
      await runPassMissing(args.dry, args.limit);
    }
    if (args.pass === 'rich' || args.pass === 'both') {
      await runPassRich(args.dry, args.limit);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs() {
  const args = { pass: 'both' as string, limit: 999999, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pass' || argv[i] === '-p')
      args.pass = argv[++i] || 'both';
    else if (argv[i] === '--limit' || argv[i] === '-l')
      args.limit = parseInt(argv[++i] || '', 10) || 999999;
    else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

main().catch((e) => {
  console.error('[ENRICH:MAL] Falhou:', e);
  process.exit(1);
});
