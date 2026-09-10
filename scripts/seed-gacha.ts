#!/usr/bin/env ts-node
/**
 * seed-gacha.ts — popula o pool do gacha com personagens do MyAnimeList
 * via API oficial v2 (X-MAL-CLIENT-ID; registrar app em myanimelist.net/
 * apiconfig). Entra personagem de todo tipo: Luffy, Ichigo, Levi etc. —
 * raridade vem de num_favorites (escala do MAL: Luffy ~150k).
 *
 * Fluxo por anime do catálogo: resolve mal_id (cache em Anime.malId; senão
 * busca por título com match de similaridade) → /anime/{id}/characters
 * (página 1: os 10 primeiros, que são os Main cadastrados primeiro) →
 * /characters/{id} com num_favorites → top por favorites → upsert.
 *
 * Uso: ts-node scripts/seed-gacha.ts [--limit N] [--dry]
 * Env: DATABASE_URL, MAL_CLIENT_ID
 */
import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const MAL = 'https://api.myanimelist.net/v2';
// ponytail: 1,1s/req sem limite documentado — a comunidade reporta ~1-2 rps
// seguro; backoff cobre 429. Catálogo completo (~2.9k animes) ≈ 10h.
const SLEEP_MS = 1100;
const RETRIES = 3;

interface MalCharacterDetail {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  main_picture?: { medium?: string | null; large?: string | null } | null;
  num_favorites?: number;
}

interface MalAnimeHit {
  node: {
    id: number;
    title?: string | null;
    alternative_titles?: { en?: string | null; synonyms?: string[] } | null;
  };
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
  if (favourites >= 50_000) return 'GALACTICA';
  if (favourites >= 20_000) return 'MITICA';
  if (favourites >= 10_000) return 'LENDARIA';
  if (favourites >= 3_000) return 'EPICA';
  if (favourites >= 800) return 'RARA';
  if (favourites >= 300) return 'INCOMUM';
  return 'COMUM';
}

// ponytail: Agent family 4 fixa IPv4 — redes sem rota v6 travam o fetch
// do Node (o DNS do MAL resolve AAAA antes).
const malAgent = new Agent({ connect: { family: 4 } });

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

function characterName(detail: MalCharacterDetail): string {
  const first = detail.first_name?.trim();
  const last = detail.last_name?.trim();
  // Formato MAL: "Monkey D., Luffy" (sobrenome, nome); nomes únicos
  // ("Naruto" id 17) têm só first_name.
  return last ? `${last}, ${first}` : (first ?? '');
}

function imageOf(detail: MalCharacterDetail): string | null {
  return detail.main_picture?.large ?? detail.main_picture?.medium ?? null;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Busca o anime por título na API oficial e exige match de similaridade
// com algum título conhecido — evita linkar o card a um homônimo errado.
async function searchMalId(title: string): Promise<number | null> {
  const json = await mal<{ data: MalAnimeHit[] }>(
    `/anime?q=${encodeURIComponent(title)}&limit=5&fields=alternative_titles`,
  );
  const target = normalizeTitle(title);
  for (const hit of json?.data ?? []) {
    const candidates = [
      hit.node.title,
      hit.node.alternative_titles?.en,
      ...(hit.node.alternative_titles?.synonyms ?? []),
    ].filter((candidate): candidate is string => Boolean(candidate));
    const matches = candidates.some((candidate) => {
      const normalized = normalizeTitle(candidate);
      return (
        normalized === target ||
        normalized.includes(target) ||
        target.includes(normalized)
      );
    });
    if (matches) return hit.node.id;
  }
  return null;
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 0 : 0;
  const dry = process.argv.includes('--dry');
  const prisma = createPrismaClient();

  let seeded = 0;
  const rarityCount: Record<string, number> = {};

  const upsert = async (
    detail: MalCharacterDetail,
    role: string,
    anime: { id: string; title: string },
  ): Promise<void> => {
    const name = characterName(detail);
    if (!name) return;
    const favourites = detail.num_favorites ?? 0;
    seeded += 1;
    const rarity = rarityFor(favourites);
    rarityCount[rarity] = (rarityCount[rarity] ?? 0) + 1;
    if (dry) return;
    await prisma.card.upsert({
      where: { malCharacterId: detail.id },
      update: {
        name,
        image: imageOf(detail),
        favourites,
        rarity,
        animeId: anime.id,
        animeTitle: anime.title,
      },
      create: {
        malCharacterId: detail.id,
        name,
        image: imageOf(detail),
        favourites,
        rarity,
        animeId: anime.id,
        animeTitle: anime.title,
      },
    });
  };

  try {
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
          console.warn(
            `[seed:gacha] [${index + 1}/${animes.length}] ${anime.title}: mal_id não encontrado`,
          );
          continue;
        }
        try {
          await prisma.anime.update({
            where: { id: anime.id },
            data: { malId },
          });
        } catch {
          console.warn(
            `[seed:gacha] [${index + 1}/${animes.length}] ${anime.title}: mal_id ${malId} já usado por outro anime`,
          );
          continue;
        }
      }

      // Página 1: 10 personagens (os Main entram primeiro no MAL).
      const list = await mal<{
        data: Array<{ node: { id: number }; role: string }>;
      }>(`/anime/${malId}/characters`);
      const candidates = (list?.data ?? []).slice(0, 10);
      if (candidates.length === 0) continue;

      const detailed: Array<{ detail: MalCharacterDetail; role: string }> = [];
      for (const candidate of candidates) {
        const detail = await mal<MalCharacterDetail>(
          `/characters/${candidate.node.id}?fields=first_name,last_name,main_picture,num_favorites`,
        );
        if (detail) detailed.push({ detail, role: candidate.role });
      }
      detailed.sort(
        (a, b) => (b.detail.num_favorites ?? 0) - (a.detail.num_favorites ?? 0),
      );
      for (const entry of detailed) {
        await upsert(entry.detail, entry.role, {
          id: anime.id,
          title: anime.title,
        });
      }
      console.log(
        `[seed:gacha] [${index + 1}/${animes.length}] ${anime.title}: ${detailed.length} personagens`,
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
