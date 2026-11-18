#!/usr/bin/env ts-node
/**
 * seed-inazuma-eleven.ts — corrige o áudio de "Inazuma Eleven" e grava o
 * mapeamento das fontes que publicam a obra.
 *
 * O Anime já existe (criado via AniList, id 5231), mas o áudio gravado é
 * LEGENDADO enquanto as fontes publicam a versão DUBLADA ("Super Onze" é o
 * título brasileiro — por isso os sites não respondem ao slug nosso). O seed
 * corrige o áudio, grava o AnimeSource das fontes mapeadas e enfileira o
 * SCAN_CATALOG que traz os episódios que faltam.
 *
 * Uso:
 *   ts-node scripts/seed-inazuma-eleven.ts           # dry-run (default)
 *   ts-node scripts/seed-inazuma-eleven.ts --apply   # grava
 *
 * Env: DATABASE_URL (a imagem de produção não tem dotenv — ele é devDep).
 */
import { AudioType, Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  extractJobKey,
  JOB_TYPE,
  PRIORITY,
  priorityForSlug,
} from '../src/watchtower/watchtower.types';

try {
  // dotenv é devDependency: existe no dev, não na imagem de produção.
  require('dotenv/config');
} catch {
  // produção: DATABASE_URL já vem do ambiente do container
}

const SLUG = 'inazuma-eleven';
const AUDIO = AudioType.DUBLADO;

/** Fonte -> slug da página de catálogo da obra (externalKey). */
const MAPPINGS: Record<string, { externalKey: string; externalUrl: string }> = {
  // 78 eps dublados em HLS direto (listagem em 2 páginas).
  animesdigital: {
    externalKey: 'inazuma-eleven',
    externalUrl: 'https://animesdigital.org/anime/a/inazuma-eleven',
  },
  // 268 eps em 4 temporadas (fallback quando o animesdigital falha).
  animesorion: {
    externalKey: 'inazuma-eleven-super-onze',
    externalUrl: 'https://animesorion.cc/animes/inazuma-eleven-super-onze/',
  },
};

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada');
  }
  const pool = new Pool({ connectionString });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

/**
 * Enfileira SCAN_CATALOG para o anime. O CatalogScanner acha os episódios da
 * fonte e enfileira a extração; sem este job o anime fica sem episódios até
 * o próximo scanAll/GAP_CHECK do scheduler.
 */
async function enqueueExtraction(
  prisma: Prisma.TransactionClient,
  animeId: string,
  slug: string,
  season: number,
  episodeNumber: number,
): Promise<void> {
  const dedupeKey = extractJobKey(animeId, season, episodeNumber);
  const payload = { animeId, slug, episodeNumber, season };
  const priority = priorityForSlug(slug, PRIORITY.EXTRACT);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "WatchtowerJob"
      ("id", "type", "dedupeKey", "payload", "priority", "maxAttempts",
       "nextRunAt", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid()::text, ${JOB_TYPE.EXTRACT_EPISODE}, ${dedupeKey},
       CAST(${JSON.stringify(payload)} AS jsonb), ${priority}, 5,
       NOW(), NOW(), NOW())
    ON CONFLICT ("type", "dedupeKey") DO UPDATE SET
      "payload" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."payload"
        ELSE EXCLUDED."payload"
      END,
      "priority" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."priority"
        ELSE LEAST("WatchtowerJob"."priority", EXCLUDED."priority")
      END,
      "status" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."status"
        ELSE 'PENDING'
      END,
      "attempts" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."attempts"
        ELSE 0
      END,
      "nextRunAt" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."nextRunAt"
        ELSE NOW()
      END,
      "lastError" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."lastError"
        ELSE NULL
      END,
      "lockedBy" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."lockedBy"
        ELSE NULL
      END,
      "lockedAt" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."lockedAt"
        ELSE NULL
      END,
      "updatedAt" = NOW()
  `);
}

async function enqueueScan(
  prisma: Prisma.TransactionClient,
  animeId: string,
  slug: string,
): Promise<void> {
  const dedupeKey = `scan-catalog:${animeId}`;
  const payload = { animeId, slug };
  // Slug em PRIORITY_SLUGS => scan entra com prioridade urgente, na frente do
  // backlog de SCAN_CATALOG que existe em produção.
  const priority = priorityForSlug(slug, PRIORITY.SCAN_CATALOG);

  // A atualização precisa ser atômica: um worker pode reivindicar o job entre
  // um findUnique e um update. O CASE preserva payload/lock/status enquanto ele
  // estiver RUNNING.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "WatchtowerJob"
      ("id", "type", "dedupeKey", "payload", "priority", "maxAttempts",
       "nextRunAt", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid()::text, ${JOB_TYPE.SCAN_CATALOG}, ${dedupeKey},
       CAST(${JSON.stringify(payload)} AS jsonb), ${priority}, 8,
       NOW(), NOW(), NOW())
    ON CONFLICT ("type", "dedupeKey") DO UPDATE SET
      "payload" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."payload"
        ELSE EXCLUDED."payload"
      END,
      "priority" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."priority"
        ELSE EXCLUDED."priority"
      END,
      "status" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."status"
        ELSE 'PENDING'
      END,
      "attempts" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."attempts"
        ELSE 0
      END,
      "nextRunAt" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."nextRunAt"
        ELSE NOW()
      END,
      "lastError" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."lastError"
        ELSE NULL
      END,
      "lockedBy" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."lockedBy"
        ELSE NULL
      END,
      "lockedAt" = CASE
        WHEN "WatchtowerJob"."status" = 'RUNNING'
        THEN "WatchtowerJob"."lockedAt"
        ELSE NULL
      END,
      "updatedAt" = NOW()
  `);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = createPrisma();
  try {
    const anime = await prisma.anime.findUnique({
      where: { slug: SLUG },
      select: { id: true, title: true, audio: true, episodeCount: true },
    });
    if (!anime) {
      throw new Error(`anime ${SLUG} não existe — crie-o pelo fluxo AniList`);
    }
    const episodes = await prisma.episode.count({
      where: { animeId: anime.id },
    });

    console.log(
      `[SEED] ${SLUG} | ${anime.title} | audio=${anime.audio} -> ${AUDIO} | ` +
        `${episodes}/${anime.episodeCount} eps`,
    );
    for (const [sourceId, mapping] of Object.entries(MAPPINGS)) {
      const existing = await prisma.animeSource.findUnique({
        where: { animeId_sourceId: { animeId: anime.id, sourceId } },
        select: { externalKey: true, externalUrl: true },
      });
      console.log(
        `[SEED]   fonte ${sourceId} | ${mapping.externalKey} | ` +
          `atual=${existing?.externalKey ?? '—'}`,
      );
    }

    if (!apply) {
      console.log('[SEED] dry-run — nada gravado (use --apply)');
      return;
    }

    const queued = await prisma.$transaction(async (tx) => {
      await tx.anime.update({
        where: { id: anime.id },
        data: { audio: AUDIO },
      });

      for (const [sourceId, mapping] of Object.entries(MAPPINGS)) {
        await tx.animeSource.upsert({
          where: {
            animeId_sourceId: { animeId: anime.id, sourceId },
          },
          update: {
            externalUrl: mapping.externalUrl,
            externalKey: mapping.externalKey,
            audio: AUDIO,
            confidence: 1,
            verifiedAt: new Date(),
            lastError: null,
          },
          create: {
            animeId: anime.id,
            sourceId,
            externalUrl: mapping.externalUrl,
            externalKey: mapping.externalKey,
            audio: AUDIO,
            confidence: 1,
            verifiedAt: new Date(),
          },
        });
      }

      const existingEpisodes = await tx.episode.findMany({
        where: { animeId: anime.id },
        select: { season: true, number: true },
      });
      for (const episode of existingEpisodes) {
        await enqueueExtraction(
          tx,
          anime.id,
          SLUG,
          episode.season,
          episode.number,
        );
      }

      await enqueueScan(tx, anime.id, SLUG);
      return existingEpisodes.length;
    });
    console.log(
      `[SEED] ${SLUG} gravado (audio=${AUDIO}, 2 fontes, ${queued} extrações existentes, scan enfileirado)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[SEED] falhou:', error);
  process.exitCode = 1;
});
