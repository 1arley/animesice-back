#!/usr/bin/env ts-node
import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const MAL = 'https://api.jikan.moe/v4';
const SLEEP_MS = 800;
const RETRIES = 3;

interface MALPictures {
  data?: Array<{
    jpg?: { image_url?: string | null; large_image_url?: string | null } | null;
    webp?: { image_url?: string | null; large_image_url?: string | null } | null;
  } | null>;
}

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tenraiAgent = new Agent({ connect: { family: 4 } });

function sameImage(a: string | null, b: string): boolean {
  if (!a) return false;
  const normalize = (url: string) =>
    url.replace(/\.(?:jpe?g|png|webp)(?:\?.*)?$/i, '');
  return normalize(a) === normalize(b);
}

async function mal(path: string): Promise<MALPictures | null> {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await sleep(SLEEP_MS);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let res;
      try {
        res = await undiciFetch(`${MAL}${path}`, {
          signal: controller.signal,
          dispatcher: tenraiAgent,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) return (await res.json()) as MALPictures;
      if (res.status === 404) return null;
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
      const pics = malId ? await mal(`/characters/${malId}/pictures`) : null;
      const alt = (pics?.data ?? [])
        .map(
          (p) =>
            p?.webp?.large_image_url ??
            p?.jpg?.large_image_url ??
            p?.webp?.image_url ??
            p?.jpg?.image_url,
        )
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
