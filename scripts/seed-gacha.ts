#!/usr/bin/env ts-node
/**
 * seed-gacha.ts — popula o pool do gacha com personagens do MyAnimeList
 * via Jikan v4 (não-oficial, sem auth, 3 req/s e 60 req/min). Entra
 * personagem de todo tipo: Luffy, Ichigo, Levi etc. — raridade vem dos
 * favorites do MAL (escala própria, bem maior que a do AniList).
 *
 * Passo 1: ranking global /top/characters (--pages páginas de 25) —
 *          cobre personagens de animes fora do catálogo (animeId null).
 * Passo 2: para cada anime do catálogo: resolve malId via busca Jikan
 *          (cacheia em Anime.malId) e sobe o top N por favorites.
 *
 * Uso: ts-node scripts/seed-gacha.ts [--limit N] [--pages N] [--dry]
 * Env: DATABASE_URL
 */
import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const JIKAN = 'https://api.jikan.moe/v4';
// ponytail: 1,1s respeita 60 req/min do Jikan; catálogo completo roda em ~1h.
const SLEEP_MS = 1100;
const PER_ANIME = 10;
const TOP_PAGES = 40;
const RETRIES = 3;

// ponytail: Agent family 4 fixa IPv4 — o fetch global do Node tenta AAAA
// primeiro e trava em redes sem rota v6. accept-encoding "gzip" apenas:
// o nginx do Jikan devolve 504 para "gzip, deflate" (testado byte a byte,
// igual ao curl que funciona). Revisar se o Jikan consertar isso.
const jikanAgent = new Agent({ connect: { family: 4 } });
const JIKAN_HEADERS = { 'accept-encoding': 'gzip' };

interface JikanCharacter {
  mal_id: number;
  name: string;
  images?: {
    jpg?: { image_url?: string | null; large_image_url?: string | null } | null;
  } | null;
  favorites?: number;
}

interface JikanAnime {
  mal_id: number;
  title?: string | null;
  title_english?: string | null;
  titles?: Array<{ type: string; title: string }>;
}

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ponytail: limiares fixos calibrados p/ escala do MAL (Luffy 149k,
// Zoro 116k, Sanji 33k, Franky 6,8k); rodar --dry e recalibrar se um
// tier secar ou inundar.
function rarityFor(favourites: number): string {
  if (favourites >= 40_000) return 'LENDARIA';
  if (favourites >= 10_000) return 'EPICA';
  if (favourites >= 3_000) return 'RARA';
  return 'COMUM';
}

async function jikan<T>(path: string): Promise<T | null> {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await sleep(SLEEP_MS);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let res;
      try {
        res = await undiciFetch(`${JIKAN}${path}`, {
          signal: controller.signal,
          dispatcher: jikanAgent,
          headers: JIKAN_HEADERS,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404 || res.status === 400) return null;
      console.warn(
        `[seed:gacha] ${path}: HTTP ${res.status} (tentativa ${attempt})`,
      );
    } catch (error) {
      console.warn(
        `[seed:gacha] ${path}: ${(error as Error).message} (tentativa ${attempt})`,
      );
    }
    await sleep(1000 * attempt);
  }
  return null;
}

function imageOf(character: JikanCharacter): string | null {
  return (
    character.images?.jpg?.large_image_url ??
    character.images?.jpg?.image_url ??
    null
  );
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Busca o anime por título e exige que o match bata com algum título
// conhecido do MAL — evita linkar o card a um anime homônimo errado.
async function searchMalId(title: string): Promise<number | null> {
  const json = await jikan<{ data: JikanAnime[] }>(
    `/anime?q=${encodeURIComponent(title)}&limit=1&sfw=true`,
  );
  const hit = json?.data?.[0];
  if (!hit) return null;
  const target = normalizeTitle(title);
  const candidates = [
    hit.title,
    hit.title_english,
    ...(hit.titles?.map((t) => t.title) ?? []),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const matches = candidates.some((candidate) => {
    const normalized = normalizeTitle(candidate);
    return (
      normalized === target ||
      normalized.includes(target) ||
      target.includes(normalized)
    );
  });
  return matches ? hit.mal_id : null;
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 0 : 0;
  const pagesArg = process.argv.indexOf('--pages');
  const pages = pagesArg >= 0 ? Number(process.argv[pagesArg + 1]) : TOP_PAGES;
  const dry = process.argv.includes('--dry');
  const prisma = createPrismaClient();

  let seeded = 0;
  const rarityCount: Record<string, number> = {};

  const upsert = async (
    character: JikanCharacter,
    anime?: { id: string; title: string } | null,
  ): Promise<void> => {
    if (!character.name?.trim()) return;
    const favourites = character.favorites ?? 0;
    seeded += 1;
    const rarity = rarityFor(favourites);
    rarityCount[rarity] = (rarityCount[rarity] ?? 0) + 1;
    if (dry) return;
    const animeData = anime
      ? { animeId: anime.id, animeTitle: anime.title }
      : {};
    await prisma.card.upsert({
      where: { malCharacterId: character.mal_id },
      update: {
        name: character.name,
        image: imageOf(character),
        favourites,
        rarity,
        ...animeData,
      },
      create: {
        malCharacterId: character.mal_id,
        name: character.name,
        image: imageOf(character),
        favourites,
        rarity,
        ...animeData,
      },
    });
  };

  try {
    // Passo 1 — ranking global (personagens de animes fora do catálogo).
    for (let page = 1; page <= pages; page++) {
      const json = await jikan<{ data: JikanCharacter[] }>(
        `/top/characters?page=${page}&limit=25`,
      );
      if (!json) break;
      for (const character of json.data ?? []) await upsert(character);
      console.log(`[seed:gacha] top global: página ${page}/${pages}`);
    }

    // Passo 2 — catálogo do site.
    const animes = await prisma.anime.findMany({
      select: { id: true, title: true, malId: true },
      orderBy: { rating: 'desc' },
      ...(limit > 0 ? { take: limit } : {}),
    });

    for (const [index, anime] of animes.entries()) {
      let malId = anime.malId;
      if (!malId) {
        malId = await searchMalId(anime.title);
        if (malId === null) {
          console.warn(`[seed:gacha] ${anime.title}: mal_id não encontrado`);
          continue;
        }
        try {
          await prisma.anime.update({
            where: { id: anime.id },
            data: { malId },
          });
        } catch {
          console.warn(
            `[seed:gacha] ${anime.title}: mal_id ${malId} já usado por outro anime`,
          );
          continue;
        }
      }

      const json = await jikan<{
        data: Array<{ character: JikanCharacter; favorites?: number }>;
      }>(`/anime/${malId}/characters`);
      if (!json) continue;
      const top = (json.data ?? [])
        .sort((a, b) => (b.favorites ?? 0) - (a.favorites ?? 0))
        .slice(0, PER_ANIME);
      for (const row of top) {
        await upsert(
          { ...row.character, favorites: row.favorites },
          { id: anime.id, title: anime.title },
        );
      }
      console.log(
        `[seed:gacha] [${index + 1}/${animes.length}] ${anime.title}: top ${top.length} upserted`,
      );
    }

    console.log(
      `[seed:gacha] fim: ${seeded} personagens${dry ? ' (dry)' : ''} — ${JSON.stringify(rarityCount)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error('[seed:gacha] fatal:', (error as Error).message);
  process.exit(1);
});
