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
import { AudioType, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
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
async function enqueueScan(
  prisma: PrismaClient,
  animeId: string,
  slug: string,
): Promise<void> {
  const dedupeKey = `scan-catalog:${animeId}`;
  const payload = { animeId, slug };
  // Slug em PRIORITY_SLUGS => scan entra com prioridade urgente, na frente do
  // backlog de SCAN_CATALOG que existe em produção.
  const priority = priorityForSlug(slug, PRIORITY.SCAN_CATALOG);
  const existing = await prisma.watchtowerJob.findUnique({
    where: { type_dedupeKey: { type: JOB_TYPE.SCAN_CATALOG, dedupeKey } },
    select: { id: true, status: true },
  });
  if (!existing) {
    await prisma.watchtowerJob.create({
      data: {
        type: JOB_TYPE.SCAN_CATALOG,
        dedupeKey,
        payload,
        priority,
      },
    });
    return;
  }
  // Job rodando pertence ao worker que o reivindicou — não mexe.
  if (existing.status === 'RUNNING') return;
  await prisma.watchtowerJob.update({
    where: { id: existing.id },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextRunAt: new Date(),
      lastError: null,
      lockedBy: null,
      lockedAt: null,
      payload,
      priority,
    },
  });
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

    await prisma.anime.update({
      where: { id: anime.id },
      data: { audio: AUDIO },
    });

    for (const [sourceId, mapping] of Object.entries(MAPPINGS)) {
      await prisma.animeSource.upsert({
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

    await enqueueScan(prisma, anime.id, SLUG);
    console.log(
      `[SEED] ${SLUG} gravado (audio=${AUDIO}, 2 fontes, scan enfileirado)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[SEED] falhou:', error);
  process.exitCode = 1;
});
