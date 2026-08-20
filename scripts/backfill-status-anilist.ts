#!/usr/bin/env ts-node
/**
 * backfill-status-anilist.ts — corrige o status dos animes no catálogo usando
 * o status real do AniList (RELEASING/FINISHED/CANCELLED/HIATUS).
 *
 * Contexto: o seed do animefire gravava `LANCAMENTO` fixo para todo anime do
 * sitemap — 96% do catálogo (incl. DBZ 1989, Berserk 1997) ficou "No ar" no
 * site. Este script re-consulta o AniList (por anilistId quando existe, senão
 * por busca de título) e reescreve status + endDate.
 *
 * Ambíguos (cleanMatch score < 0.6) ficam intocados e vão p/ stderr (revisão).
 *
 * Uso: ts-node scripts/backfill-status-anilist.ts [--limit N] [--offset N] [--dry]
 * Env: DATABASE_URL
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const SLEEP_MS = 1000;
const MIN_SCORE = 0.6;
const RATE_LIMIT_BACKOFF = [2000, 4000, 8000, 15000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

interface AniListMedia {
  id: number;
  status?: string | null;
  seasonYear?: number | null;
  season?: string | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  endDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
}

/** Status AniList -> vocabulário do frontend (src/lib/status.ts). */
const STATUS_MAP: Record<string, string> = {
  RELEASING: 'LANCAMENTO',
  NOT_YET_RELEASED: 'LANCAMENTO',
  FINISHED: 'FINALIZADO',
  CANCELLED: 'CANCELADO',
  HIATUS: 'HIATUS',
};

function fuzzyDate(parts?: {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}): Date | null {
  if (!parts?.year) return null;
  const date = new Date(Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day ?? 1));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchMedia(search: string, id?: number | null): Promise<AniListMedia | null> {
  const query = `
    query ($id: Int, $search: String) {
      Media(id: $id, search: $search, type: ANIME) {
        id
        status
        seasonYear
        season
        startDate { year month day }
        endDate { year month day }
        title { romaji english native }
      }
    }`;
  const variables = id ? { id } : { search };
  for (let attempt = 0; attempt < RATE_LIMIT_BACKOFF.length; attempt++) {
    try {
      const res = await fetch(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429) {
        await sleep(RATE_LIMIT_BACKOFF[attempt]!);
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as any;
      if (json?.errors) {
        await sleep(2000);
        continue;
      }
      return json?.data?.Media ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Busca por anilistId quando existe; senão tenta variantes de título/slug. */
async function findMedia(anime: {
  anilistId: number | null;
  title: string;
  slug: string;
}): Promise<AniListMedia | null> {
  if (anime.anilistId) {
    return fetchMedia('', anime.anilistId);
  }
  const candidates = searchVariants(anime);
  for (const candidate of candidates) {
    const media = await fetchMedia(candidate);
    if (media) return media;
  }
  return null;
}

/** Variantes de busca: título cru, depois o slug sem marcas de dublado/número. */
function searchVariants(anime: { title: string; slug: string }): string[] {
  const variants: string[] = [];
  const title = anime.title?.trim();
  if (title) variants.push(title);
  const base = anime.slug
    .replace(/-dublado(-\d+)?$/i, '')
    .replace(/-\d+$/, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (base && !variants.includes(base)) variants.push(base);
  return variants.slice(0, 3);
}

function similarity(a: string, b: string): number {
  const la = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lb = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!la || !lb) return 0;
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
    where: { published: true },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      year: true,
      season: true,
      endDate: true,
      anilistId: true,
    },
    orderBy: { id: 'asc' },
    skip: args.offset,
    take: args.limit,
  });
  console.log(`[BACKFILL] ${animes.length} animes para revisão`);

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const anime of animes) {
    const key = anime.title || anime.slug.replace(/-/g, ' ');
    const media = await findMedia(anime);
    await sleep(SLEEP_MS);

    if (!media?.status) {
      console.error(`  ? ${anime.slug} — sem resposta no AniList`);
      skipped++;
      continue;
    }

    const target = STATUS_MAP[media.status];
    if (!target) {
      console.error(`  ? ${anime.slug} — status AniList desconhecido: ${media.status}`);
      skipped++;
      continue;
    }

    const mediaTitle = media.title?.romaji || media.title?.english || media.title?.native || '';
    if (!anime.anilistId && similarity(key, mediaTitle) < MIN_SCORE) {
      console.error(
        `  ! ${anime.slug} — ambíguo (score=${similarity(key, mediaTitle).toFixed(2)}): AniList="${mediaTitle}" id=${media.id}`,
      );
      skipped++;
      continue;
    }

    const endDate = fuzzyDate(media.endDate ?? undefined);
    const year = anime.year ?? media.seasonYear ?? null;
    const season =
      (anime.season ?? media.season ??
        null) as 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL' | null;

    const sameStatus = anime.status === target;
    const sameEnd = !anime.endDate && !endDate
      ? true
      : anime.endDate?.getTime() === endDate?.getTime();
    const sameMeta = year === anime.year && season === anime.season;

    if (sameStatus && sameEnd && sameMeta) {
      unchanged++;
      continue;
    }

    if (!args.dry) {
      await prisma.anime.update({
        where: { id: anime.id },
        data: {
          status: target,
          endDate,
          ...(anime.year == null ? { year } : {}),
          ...(anime.season == null ? { season } : {}),
        },
      });
    }
    console.log(
      `  ${args.dry ? '~' : '✓'} ${anime.slug}: ${anime.status} -> ${target}` +
        (endDate ? ` (fim ${endDate.getUTCFullYear()})` : ''),
    );
    updated++;
  }

  console.log(
    `\n[BACKFILL] ${updated} para atualizar${args.dry ? ' (dry-run)' : ' (aplicado)'}, ${unchanged} iguais, ${skipped} intocados`,
  );
  await prisma.$disconnect();
}

function parseArgs() {
  const args = { limit: 999999, offset: 0, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' || argv[i] === '-l')
      args.limit = parseInt(argv[++i] || '', 10) || 999999;
    else if (argv[i] === '--offset' || argv[i] === '-o')
      args.offset = parseInt(argv[++i] || '', 10) || 0;
    else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

main().catch((e) => {
  console.error('[BACKFILL] Falhou:', e);
  process.exit(1);
});
