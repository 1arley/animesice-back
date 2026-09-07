#!/usr/bin/env ts-node
/**
 * seed-gacha.ts — popula o pool do gacha waifu com os personagens mais
 * favoritados de cada anime com anilistId (top 8 por anime, sem filtro
 * adult: retratos do AniList são SFW).
 *
 * Uso: ts-node scripts/seed-gacha.ts [--limit N] [--dry]
 * Env: DATABASE_URL
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const SLEEP_MS = 700;
const PER_ANIME = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// ponytail: limiares fixos de favourites; recalibrar se um tier secar ou inundar.
function rarityFor(favourites: number): string {
  if (favourites >= 10000) return 'LENDARIA';
  if (favourites >= 3000) return 'EPICA';
  if (favourites >= 800) return 'RARA';
  return 'COMUM';
}

interface AniListCharacter {
  id: number;
  name: { full?: string | null };
  image?: { large?: string | null } | null;
  favourites?: number | null;
}

async function fetchCharacters(anilistId: number): Promise<AniListCharacter[]> {
  const query = `
    query ($id: Int) {
      Media(id: $id) {
        characters(sort: [FAVOURITES_DESC]) {
          nodes { id name { full } image { large } favourites }
        }
      }
    }`;
  await sleep(SLEEP_MS);
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { id: anilistId } }),
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { Media: { characters: { nodes: AniListCharacter[] } } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length)
    throw new Error(`AniList: ${json.errors[0]?.message}`);
  return json.data?.Media.characters.nodes ?? [];
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 0 : 0;
  const dry = process.argv.includes('--dry');
  const prisma = createPrismaClient();

  try {
    const animes = await prisma.anime.findMany({
      where: { anilistId: { not: null } },
      select: { id: true, title: true, anilistId: true },
      orderBy: { rating: 'desc' },
      ...(limit > 0 ? { take: limit } : {}),
    });

    let upserted = 0;
    for (const anime of animes) {
      if (anime.anilistId === null) continue;
      let characters: AniListCharacter[];
      try {
        characters = await fetchCharacters(anime.anilistId);
      } catch (error) {
        console.error(
          `[seed:gacha] ${anime.title}: ${(error as Error).message}`,
        );
        continue;
      }
      for (const character of characters.slice(0, PER_ANIME)) {
        const name = character.name.full?.trim();
        if (!name) continue;
        const favourites = character.favourites ?? 0;
        if (dry) {
          upserted += 1;
          continue;
        }
        await prisma.waifu.upsert({
          where: { anilistCharacterId: character.id },
          update: {
            name,
            image: character.image?.large ?? null,
            favourites,
            rarity: rarityFor(favourites),
          },
          create: {
            anilistCharacterId: character.id,
            name,
            image: character.image?.large ?? null,
            favourites,
            rarity: rarityFor(favourites),
            animeId: anime.id,
            animeTitle: anime.title,
          },
        });
        upserted += 1;
      }
      console.log(`[seed:gacha] ${anime.title}: ${upserted} acumuladas`);
    }
    console.log(
      `[seed:gacha] fim: ${upserted} personagens${dry ? ' (dry)' : ''}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error('[seed:gacha] fatal:', (error as Error).message);
  process.exit(1);
});
