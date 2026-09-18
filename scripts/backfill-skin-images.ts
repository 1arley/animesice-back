#!/usr/bin/env ts-node
import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const MAL = 'https://api.myanimelist.net/v2';
// ponytail: 1,1s/req sem limite documentado — a comunidade reporta ~1-2 rps
// seguro; backoff cobre 429.
const SLEEP_MS = 1100;
const RETRIES = 3;

interface MALCharacterPictures {
  pictures?: Array<{
    medium?: string | null;
    large?: string | null;
  } | null>;
}

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const malAgent = new Agent({ connect: { family: 4 } });

function malHeaders(): Record<string, string> {
  if (!process.env.MAL_CLIENT_ID) {
    throw new Error(
      'MAL_CLIENT_ID ausente — registre o app em myanimelist.net/apiconfig',
    );
  }
  return { 'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID };
}

function sameImage(a: string | null, b: string): boolean {
  if (!a) return false;
  const normalize = (url: string) =>
    url.replace(/\.(?:jpe?g|png|webp)(?:\?.*)?$/i, '');
  return normalize(a) === normalize(b);
}

async function malCharacterPictures(
  malId: number,
): Promise<MALCharacterPictures | null> {
  const path = `/characters/${malId}?fields=pictures`;
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
      if (res.ok) return (await res.json()) as MALCharacterPictures;
      if (res.status === 400 || res.status === 404) return null;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') || 5) * 1000;
        await sleep(Math.min(retryAfter, 30_000));
        continue;
      }
      console.warn(
        `[skin-images] ${path}: HTTP ${res.status} (tentativa ${attempt})`,
      );
    } catch (error) {
      console.warn(
        `[skin-images] ${path}: ${(error as Error).message} (tentativa ${attempt})`,
      );
    }
    await sleep(1000 * attempt);
  }
  return null;
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 0 : 0;
  const dry = process.argv.includes('--dry');
  const prisma = createPrismaClient();

  const counts = { updated: 0, blocked: 0, skipped: 0, failed: 0 };

  try {
    const skins = await prisma.gachaSkin.findMany({
      select: {
        id: true,
        imageUrl: true,
        card: { select: { malCharacterId: true, image: true } },
      },
      orderBy: { id: 'asc' },
      ...(limit > 0 ? { take: limit } : {}),
    });
    const targets = skins.filter(
      (s) => s.card && sameImage(s.card.image, s.imageUrl),
    );
    console.log(
      `[skin-images] ${skins.length} skins, ${targets.length} com imagem igual à carta`,
    );

    for (const [index, skin] of targets.entries()) {
      const cardImage = skin.card?.image ?? '';
      const malId = skin.card?.malCharacterId;
      const pics = malId ? await malCharacterPictures(malId) : null;
      const alt = (pics?.pictures ?? [])
        .map((p) => p?.large ?? p?.medium)
        .find((url) => url?.startsWith('https://') && !sameImage(cardImage, url));

      if (!alt) {
        if (pics === null && malId) {
          counts.failed += 1;
        } else {
          counts.blocked += 1;
          if (!dry)
            await prisma.gachaSkin.update({
              where: { id: skin.id },
              data: { blocked: true },
            });
        }
      } else if (dry) {
        counts.updated += 1;
      } else {
        await prisma.gachaSkin.update({
          where: { id: skin.id },
          data: { imageUrl: alt },
        });
        await prisma.userGachaSkin.updateMany({
          where: { skinId: skin.id, imageUrl: cardImage },
          data: { imageUrl: alt },
        });
        counts.updated += 1;
      }
      if ((index + 1) % 200 === 0) {
        console.log(
          `[skin-images] [${index + 1}/${targets.length}] ${JSON.stringify(counts)}`,
        );
      }
    }
    counts.skipped = skins.length - targets.length;
    console.log(
      `[skin-images] fim${dry ? ' (dry)' : ''}: ${JSON.stringify(counts)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error('[skin-images] fatal:', (error as Error).message);
  process.exit(1);
});
