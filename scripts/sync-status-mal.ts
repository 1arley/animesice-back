#!/usr/bin/env ts-node
/**
 * sync-status-mal.ts — corrige LANCAMENTO verdadeiros/falsos usando MyAnimeList.
 *
 * Fonte preferida: API oficial v2 (MAL_CLIENT_ID; mesmo auth do seed-gacha).
 * Fallback: Jikan (api.jikan.moe/v4, sem chave; seed.ts já usa este endpoint).
 *
 * Regra: Currently Airing -> LANCAMENTO | Finished Airing -> FINALIZADO
 * | Not yet aired -> EM_BREVE. Resolve malId por Anime.malId, senão busca
 * por título com limiar 0.6 (mesma régua do backfill-anilist-id).
 *
 * Uso: ts-node scripts/sync-status-mal.ts [--status LANCAMENTO|FINALIZADO|all] [--limit N] [--dry]
 * Env: DATABASE_URL, MAL_CLIENT_ID (opcional — sem chave usa Jikan)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const JIKAN = 'https://api.jikan.moe/v4';
const MAL = 'https://api.myanimelist.net/v2';
const SLEEP_MS = 1100;
const MIN_SCORE = 0.6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

interface JikanAnime {
  mal_id: number;
  title: string;
  title_english?: string | null;
  status?: string | null;
  airing?: boolean | null;
}

interface MalOfficialAnime {
  id: number;
  title: string;
  status?: string | null;
  alternative_titles?: { en?: string | null; synonyms?: string[] } | null;
}

function malHeaders(): Record<string, string> {
  return { 'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID ?? '' };
}

async function fetchMalOfficial<T>(path: string): Promise<T | null> {
  if (!process.env.MAL_CLIENT_ID) return null;
  try {
    const res = await fetch(`${MAL}${path}`, {
      headers: malHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function mapMalOfficialStatus(status?: string | null): string | null {
  switch ((status ?? '').toLowerCase().replace(/[^a-z_]/g, '')) {
    case 'currently_airing':
      return 'LANCAMENTO';
    case 'finished_airing':
      return 'FINALIZADO';
    case 'not_yet_aired':
      return 'EM_BREVE';
    default:
      return null;
  }
}

function mapStatus(j: JikanAnime): string | null {
  const s = (j.status ?? '').toLowerCase();
  if (s.includes('currently')) return 'LANCAMENTO';
  if (s.includes('finished')) return 'FINALIZADO';
  if (s.includes('not yet')) return 'EM_BREVE';
  if (j.airing === true) return 'LANCAMENTO';
  if (j.airing === false) return 'FINALIZADO';
  return null;
}

async function fetchJikan<T>(path: string, retries = 5): Promise<T | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${JIKAN}${path}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: T };
      return json.data ?? null;
    } catch {
      await sleep(2000 * (attempt + 1));
    }
  }
  return null;
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

async function resolveBySearch(title: string, slug: string): Promise<JikanAnime | null> {
  const q = title || slug.replace(/-/g, ' ');
  if (process.env.MAL_CLIENT_ID) {
    const json = await fetchMalOfficial<{ data: Array<{ node: MalOfficialAnime }> }>(
      `/anime?q=${encodeURIComponent(q)}&limit=3&fields=status,alternative_titles`,
    );
    const target = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const hit of json?.data ?? []) {
      const candidates = [
        hit.node.title,
        hit.node.alternative_titles?.en,
        ...(hit.node.alternative_titles?.synonyms ?? []),
      ].filter((c): c is string => Boolean(c));
      const best = candidates.some((c) => {
        const n = c.toLowerCase().replace(/[^a-z0-9]/g, '');
        return n === target || n.includes(target) || target.includes(n);
      });
      if (!best) continue;
      const full = await fetchMalOfficial<MalOfficialAnime>(
        `/anime/${hit.node.id}?fields=status`,
      );
      if (full?.status) {
        return {
          mal_id: hit.node.id,
          title: hit.node.title,
          status: full.status.replace(/_/g, ' '),
        };
      }
    }
    return null;
  }
  const list = await fetchJikan<JikanAnime[]>(`/anime?q=${encodeURIComponent(q)}&limit=3&order_by=members&sort=desc`);
  if (!list?.length) return null;
  for (const hit of list) {
    const name = hit.title_english || hit.title;
    if (similarity(q, name) >= MIN_SCORE) return hit;
  }
  return null;
}

function parseArgs() {
  const args = { status: 'all', limit: 999999, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--status') args.status = (argv[++i] || 'all').toUpperCase();
    else if (argv[i] === '--limit' || argv[i] === '-l') args.limit = parseInt(argv[++i] || '', 10) || 999999;
    else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const where: { published: boolean; status?: string } =
    args.status === 'ALL' ? { published: true } : { published: true, status: args.status };
  const animes = await prisma.anime.findMany({
    where,
    select: { id: true, slug: true, title: true, status: true, malId: true },
    orderBy: { id: 'asc' },
    take: args.limit,
  });
  console.log(`[SYNC:MAL] ${animes.length} animes (filtro=${args.status}${args.dry ? ', dry' : ''})`);

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const anime of animes) {
    let detail: JikanAnime | null = null;
    let malId = anime.malId;
    if (malId) {
      if (process.env.MAL_CLIENT_ID) {
        const full = await fetchMalOfficial<MalOfficialAnime>(
          `/anime/${malId}?fields=status`,
        );
        const mapped = mapMalOfficialStatus(full?.status);
        if (mapped && full) {
          detail = { mal_id: malId, title: anime.title, status: full.status };
        } else if (full && !mapped) {
          console.error(`  ? ${anime.slug} — status MAL desconhecido: ${full.status}`);
          skipped++;
          await sleep(SLEEP_MS);
          continue;
        }
      }
      detail ??= await fetchJikan<JikanAnime>(`/anime/${malId}`);
    } else {
      detail = await resolveBySearch(anime.title, anime.slug);
      if (detail) malId = detail.mal_id;
    }
    await sleep(SLEEP_MS);
    if (!detail) {
      console.error(`  ? ${anime.slug} — sem match no MAL`);
      skipped++;
      continue;
    }
    const target = mapStatus(detail);
    if (!target) {
      console.error(`  ? ${anime.slug} — status MAL desconhecido: ${detail.status}`);
      skipped++;
      continue;
    }
    // ponytail: sem malId + score baixo já barrado em resolveBySearch; ambíguo vira skip acima
    if (target === anime.status && malId === anime.malId) {
      unchanged++;
      continue;
    }
    if (!args.dry) {
      try {
        await prisma.anime.update({
          where: { id: anime.id },
          data: { status: target, ...(malId && !anime.malId ? { malId } : {}) },
        });
      } catch {
        console.error(`  ? ${anime.slug} — malId ${malId} colidiu, status aplicado sem malId`);
        if (target !== anime.status) {
          await prisma.anime.update({ where: { id: anime.id }, data: { status: target } });
        } else {
          skipped++;
          continue;
        }
      }
    }
    console.log(`  ${args.dry ? '~' : '✓'} ${anime.slug}: ${anime.status} -> ${target} (MAL#${malId} ${detail.status})`);
    updated++;
  }

  console.log(`\n[SYNC:MAL] ${updated} para atualizar${args.dry ? ' (dry)' : ''}, ${unchanged} iguais, ${skipped} sem match`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[SYNC:MAL] Falhou:', e);
  process.exit(1);
});
