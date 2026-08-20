#!/usr/bin/env ts-node
/**
 * enrich-synopsis.ts — substitui sinopses genéricas ("Assistir X online") por
 * sinopses reais do AniList.
 *
 * 2.748 animes (~96% do catálogo) tinham a synopsis template "Assistir {título}
 * online" — conteúdo idêntico/gerado que o Google tratava como fino e não
 * indexava ("Rastreada, mas não indexada no momento"). Este script preenche a
 * descrição real vinda do AniList (por anilistId, ou por busca de título com
 * verificação de similaridade quando não há anilistId).
 *
 * Uso: ts-node scripts/enrich-synopsis.ts [--limit N] [--dry]
 * Env: DATABASE_URL
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const SLEEP_MS = 700;
const MIN_DESCRIPTION_LENGTH = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

interface AniListDescription {
  description?: string | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
}

function stripHtml(description: string): string {
  return description
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Similaridade por bigrams (Dice) — mais robusta que o Jaccard de conjuntos:
 * penaliza títulos de comprimentos muito diferentes ("Naruto" vs
 * "Naruto: Shippuden" fica ~0.55, rejeitado) e sequência/token order.
 * Combinada com a razão de comprimento, evita casar a sinopse de um título
 * errado da franquia (o que o SEARCH_MATCH do AniList muitas vezes retorna).
 */
function bigramDice(a: string, b: string): number {
  const grams = (s: string): Map<string, number> => {
    const norm = s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const map = new Map<string, number>();
    if (norm.length < 2) return map;
    for (let i = 0; i < norm.length - 1; i++) {
      const g = norm.slice(i, i + 2);
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return map;
  };

  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;

  let inter = 0;
  for (const [g, count] of A) {
    const inB = B.get(g);
    if (inB != null) inter += Math.min(count, inB);
  }
  const totalA = [...A.values()].reduce((acc, v) => acc + v, 0);
  const totalB = [...B.values()].reduce((acc, v) => acc + v, 0);
  return (2 * inter) / (totalA + totalB);
}

function lengthRatio(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const la = norm(a).length;
  const lb = norm(b).length;
  if (la === 0 || lb === 0) return 0;
  return Math.min(la, lb) / Math.max(la, lb);
}

/** Limiar aceito para casar um anime SEM anilistId por busca de título. */
const SEARCH_MATCH_MIN_DICE = 0.72;
const SEARCH_MATCH_MIN_LENGTH_RATIO = 0.5;

function isStrongTitleMatch(a: string, b: string): boolean {
  return (
    bigramDice(a, b) >= SEARCH_MATCH_MIN_DICE &&
    lengthRatio(a, b) >= SEARCH_MATCH_MIN_LENGTH_RATIO
  );
}

async function fetchMediaById(id: number): Promise<AniListDescription | null> {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        description
        title { romaji english native }
      }
    }`;
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { id } }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    return json?.data?.Media ?? null;
  } catch {
    return null;
  }
}

async function searchMedia(search: string): Promise<AniListDescription | null> {
  const query = `
    query ($search: String) {
      Page(perPage: 1) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          description
          title { romaji english native }
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

function isTemplateSynopsis(synopsis: string | null | undefined): boolean {
  if (!synopsis) return false;
  return /^Assistir\s+.+\s+online$/.test(synopsis.trim());
}

function parseArgs() {
  const args = { limit: 999999, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' || argv[i] === '-l') {
      const parsed = parseInt(argv[++i] || '', 10);
      // --limit ausente/0/inválido = catálogo inteiro (documentado).
      args.limit = Number.isNaN(parsed) || parsed <= 0 ? 999999 : parsed;
    } else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

async function main() {
  const args = parseArgs();

  const animes = await prisma.anime.findMany({
    where: {
      published: true,
      synopsis: { contains: 'Assistir', mode: 'insensitive' },
    },
    select: { id: true, slug: true, title: true, synopsis: true, anilistId: true },
    take: args.limit,
  });

  const candidates = animes.filter((a) => isTemplateSynopsis(a.synopsis));
  console.log(`[ENRICH] ${candidates.length} animes com sinopse template (de ${animes.length} com "Assistir")`);

  let enriched = 0;
  let failed = 0;
  let skipped = 0;

  for (const anime of candidates) {
    try {
      let media: AniListDescription | null = null;

      if (anime.anilistId) {
        media = await fetchMediaById(anime.anilistId);
      } else {
        const searchQuery = anime.title || anime.slug.replace(/-/g, ' ');
        media = await searchMedia(searchQuery);
      }
      await sleep(SLEEP_MS);

      const rawDescription = media?.description ?? null;
      const description = rawDescription ? stripHtml(rawDescription) : '';
      const titleMatch = media?.title?.romaji || media?.title?.english || '';

      // Sem anilistId confiável, o match é por busca de título: só grava se o
      // título bater FORTE (Dice de bigrams + razão de comprimento). Um match
      // fraco aqui copiaria a sinopse de outro título da franquia.
      if (anime.anilistId == null) {
        const strongMatch =
          Boolean(anime.title) &&
          Boolean(titleMatch) &&
          isStrongTitleMatch(anime.title, titleMatch);
        if (!strongMatch) {
          console.error(
            `  ! ${anime.slug} — match fraco/ausente (AniList="${titleMatch}" dice=${bigramDice(anime.title, titleMatch).toFixed(2)}), pulando`,
          );
          skipped++;
          continue;
        }
      }

      if (description.length < MIN_DESCRIPTION_LENGTH) {
        console.error(`  ? ${anime.slug} — sem descrição real no AniList, pulando`);
        skipped++;
        continue;
      }

      if (!args.dry) {
        await prisma.anime.update({
          where: { id: anime.id },
          data: { synopsis: description.slice(0, 2000) },
        });
      }
      console.log(`  ✓ ${anime.slug} (${description.length} chars)`);
      enriched++;
    } catch (e) {
      console.error(`  ✗ ${anime.slug} — ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(
    `\n[ENRICH] ${enriched} enriquecidas, ${skipped} sem descrição, ${failed} com erro${args.dry ? ' (DRY RUN — nada gravado)' : ''}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[ENRICH] Falhou:', e);
  process.exit(1);
});