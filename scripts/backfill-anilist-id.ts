#!/usr/bin/env ts-node
/**
 * backfill-anilist-id.ts — casa animes existentes (sem anilistId) com AniList
 * por título/slug. Preenche anilistId + year/season/format/episodeCount/studios.
 *
 * Ambíguos (cleanMatch score < 0.6) vão p/ lista de revisão admin (stderr).
 *
 * Uso: ts-node scripts/backfill-anilist-id.ts [--limit N] [--dry]
 * Env: DATABASE_URL
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const SLEEP_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

interface AniListMedia {
  id: number;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  season?: string | null;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  studios?: { nodes?: Array<{ name: string; isAnimationStudio?: boolean }> | null } | null;
  status?: string | null;
}

async function searchAniList(search: string): Promise<AniListMedia | null> {
  const query = `
    query ($search: String) {
      Page(perPage: 1) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title { romaji english native }
          season
          seasonYear
          format
          episodes
          status
          studios(isMain: true) { nodes { name isAnimationStudio } }
        }
      }
    }`;
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { search } }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    return json?.data?.Page?.media?.[0] ?? null;
  } catch {
    return null;
  }
}

function similarity(a: string, b: string): number {
  const la = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lb = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (la === lb) return 1;
  if (la.includes(lb) || lb.includes(la)) return 0.85;
  const setA = new Set(la.split(''));
  const setB = new Set(lb.split(''));
  let inter = 0;
  for (const c of setA) if (setB.has(c)) inter++;
  return inter / Math.max(setA.size, setB.size);
}

async function main() {
  const args = parseArgs();
  const animes = await prisma.anime.findMany({
    where: { anilistId: null },
    select: { id: true, slug: true, title: true },
    take: args.limit,
  });
  console.log(`[BACKFILL] ${animes.length} animes sem anilistId`);

  let matched = 0;
  let ambiguous = 0;

  for (const anime of animes) {
    const searchQuery = anime.title || anime.slug.replace(/-/g, ' ');
    const media = await searchAniList(searchQuery);
    await sleep(SLEEP_MS);

    if (!media) {
      console.error(`  ? ${anime.slug} — sem match no AniList`);
      continue;
    }

    const score = similarity(anime.title || anime.slug, media.title.romaji || media.title.english || media.title.native || '');
    if (score < 0.6) {
      console.error(`  ! ${anime.slug} — ambíguo (score=${score.toFixed(2)}): AniList="${media.title.romaji ?? media.title.english}" id=${media.id}`);
      ambiguous++;
      continue;
    }

    if (!args.dry) {
      await prisma.anime.update({
        where: { id: anime.id },
        data: {
          anilistId: media.id,
          year: media.seasonYear ?? null,
          season: (media.season as 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL') ?? null,
          format: (media.format as 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MUSIC') ?? null,
          episodeCount: media.episodes ?? null,
          studios: media.studios?.nodes?.map((n) => n.name).filter((n): n is string => Boolean(n)) ?? [],
        },
      });
    }
    console.log(`  ✓ ${anime.slug} -> AniList#${media.id} (${score.toFixed(2)})`);
    matched++;
  }

  console.log(`\n[BACKFILL] ${matched} matched, ${ambiguous} ambiguous, ${animes.length - matched - ambiguous} no match`);
  await prisma.$disconnect();
}

function parseArgs() {
  const args = { limit: 999999, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' || argv[i] === '-l') args.limit = parseInt(argv[++i] || '', 10) || 999999;
    else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

main().catch((e) => {
  console.error('[BACKFILL] Falhou:', e);
  process.exit(1);
});
