#!/usr/bin/env ts-node
/**
 * seed-avatar-seven-havens.ts — semeia "Avatar: Seven Havens" (legendado e
 * dublado) no catálogo com o mapeamento da fonte topanimes.
 *
 * Por que seed manual: a obra não está no AniList (medido em 30/10/2026), o
 * SeasonDiscovery não a cria e o ReleaseMonitor não a acompanha. O seed grava
 * o Anime + o AnimeSource (sourceId='topanimes'); o CatalogScanner lê o
 * mapeamento, acha os episódios na listagem da fonte e enfileira a extração.
 *
 * Uso:
 *   ts-node scripts/seed-avatar-seven-havens.ts           # dry-run (default)
 *   ts-node scripts/seed-avatar-seven-havens.ts --apply   # grava
 *
 * Env: DATABASE_URL (a imagem de produção não tem dotenv — ele é devDep).
 */
import {
  AnimeFormat,
  AnimeSeason,
  AudioType,
  PrismaClient,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { parseTopanimesCatalog } from '../src/embed/scrape/topanimes.catalog';
import { JOB_TYPE, PRIORITY } from '../src/watchtower/watchtower.types';

try {
  // dotenv é devDependency: existe no dev, não na imagem de produção.
  require('dotenv/config');
} catch {
  // produção: DATABASE_URL já vem do ambiente do container
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SOURCE_ID = 'topanimes';

interface Seed {
  /** Slug no catálogo animesice. */
  slug: string;
  title: string;
  /** Slug da obra na fonte (página /animes/<sourceSlug>/). */
  sourceSlug: string;
  audio: AudioType;
  /** Título original (vai para alternativeTitles). */
  originalTitle: string;
}

const SEEDS: Seed[] = [
  {
    slug: 'avatar-seven-havens',
    title: 'Avatar: Os Sete Refúgios',
    sourceSlug: 'avatar-seven-havens',
    audio: AudioType.LEGENDADO,
    originalTitle: 'Avatar: Seven Havens',
  },
  {
    slug: 'avatar-seven-havens-dublado',
    title: 'Avatar: Os Sete Refúgios Dublado',
    sourceSlug: 'avatar-seven-havens-dublado',
    audio: AudioType.DUBLADO,
    originalTitle: 'Avatar: Seven Havens',
  },
];

/** Gênero do topanimes (pt-BR) -> taxonomia do catálogo (inglês, do AniList). */
const GENRES: Record<string, { slug: string; name: string }> = {
  Ação: { slug: 'action', name: 'Action' },
  Aventura: { slug: 'adventure', name: 'Adventure' },
  Fantasia: { slug: 'fantasy', name: 'Fantasy' },
  'Ficção Científica': { slug: 'sci-fi', name: 'Sci-Fi' },
  Kids: { slug: 'kids', name: 'Kids' },
  'Super Poder': { slug: 'super-power', name: 'Super Power' },
  Família: { slug: 'family', name: 'Family' },
};

const RELEASE_DATE = new Date('2026-10-09T00:00:00.000Z');

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada');
  }
  const pool = new Pool({ connectionString });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

async function fetchCatalog(sourceSlug: string): Promise<string> {
  const url = `https://topanimes.net/animes/${sourceSlug}/`;
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'pt-BR,pt;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`topanimes: ${url} retornou ${res.status}`);
  }
  return res.text();
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
        priority: PRIORITY.SCAN_CATALOG,
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
      priority: PRIORITY.SCAN_CATALOG,
    },
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = createPrisma();
  try {
    for (const seed of SEEDS) {
      const catalog = parseTopanimesCatalog(
        await fetchCatalog(seed.sourceSlug),
      );
      if (catalog.episodes.length === 0) {
        throw new Error(
          `topanimes: ${seed.sourceSlug} não devolveu episódios — abortando`,
        );
      }

      // No dry-run nada é escrito: os gêneros só são upsertados no --apply.
      const genreIds: string[] = [];
      if (apply) {
        for (const sourceGenre of catalog.genres) {
          const genre = GENRES[sourceGenre];
          if (!genre) continue;
          const record = await prisma.genre.upsert({
            where: { slug: genre.slug },
            update: {},
            create: { slug: genre.slug, name: genre.name },
          });
          genreIds.push(record.id);
        }
      }

      const data = {
        title: seed.title,
        synopsis: catalog.synopsis,
        coverImage: catalog.poster,
        ageRating: 'A14',
        status: 'LANCAMENTO',
        audio: seed.audio,
        format: AnimeFormat.TV,
        year: 2026,
        season: AnimeSeason.FALL,
        releaseDate: RELEASE_DATE,
        episodeCount: catalog.episodes.length,
        alternativeTitles: [seed.originalTitle],
      };

      const externalUrl = `https://topanimes.net/animes/${seed.sourceSlug}/`;
      const existing = await prisma.anime.findUnique({
        where: { slug: seed.slug },
        select: { id: true },
      });

      if (!apply) {
        console.log(
          `[SEED] ${seed.slug} | ${seed.title} (${seed.audio}) | ` +
            `${catalog.episodes.length} eps | ${externalUrl} | ` +
            `gêneros=${catalog.genres.join(', ')} | ` +
            `existente=${Boolean(existing)}`,
        );
        continue;
      }

      const anime = await prisma.anime.upsert({
        where: { slug: seed.slug },
        update: {
          ...data,
          genres: { set: genreIds.map((id) => ({ id })) },
        },
        create: {
          slug: seed.slug,
          ...data,
          genres: { connect: genreIds.map((id) => ({ id })) },
        },
      });

      await prisma.animeSource.upsert({
        where: { animeId_sourceId: { animeId: anime.id, sourceId: SOURCE_ID } },
        update: {
          externalUrl,
          externalKey: seed.sourceSlug,
          audio: seed.audio,
          confidence: 1,
          verifiedAt: new Date(),
          lastError: null,
        },
        create: {
          animeId: anime.id,
          sourceId: SOURCE_ID,
          externalUrl,
          externalKey: seed.sourceSlug,
          audio: seed.audio,
          confidence: 1,
          verifiedAt: new Date(),
        },
      });

      await enqueueScan(prisma, anime.id, seed.slug);

      console.log(
        `[SEED] ${seed.slug} gravado | ${anime.id} | ${catalog.episodes.length} eps | ${externalUrl}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[SEED] falhou:', error);
  process.exitCode = 1;
});
