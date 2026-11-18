#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
try {
  require('dotenv/config');
} catch {
  // DATABASE_URL is injected in production.
}
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const TARGETS = [
  {
    slug: 'bleach',
    sourceSlug: 'bleach',
    meusSourceSlug: 'bleach-1',
    meusPageSlug: 'bleach',
  },
  {
    slug: 'bleach-dublado',
    sourceSlug: 'bleach-dublado',
    meusSourceSlug: 'bleach-dublado',
    meusPageSlug: 'bleach-dublado',
  },
  {
    slug: 'bleach-2',
    sourceSlug: 'bleach-sennen-kessen-hen',
    animesonline: true,
  },
  {
    slug: 'bleach-sennen-kessen-hen-kashin-tan',
    sourceSlug: 'bleach-sennen-kessen-hen-kashin-tan',
  },
];

async function catalog(sourceSlug) {
  const url = `https://topanimes.net/animes/${sourceSlug}/`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'AnimesIceCatalogRepair/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} retornou HTTP ${response.status}`);
  const html = await response.text();
  const episodes = [...html.matchAll(
    /class=['"]item-(\d+)['"][^>]*>[\s\S]{0,1000}?href=['"](https:\/\/topanimes\.net\/episodio\/[^'"]+)['"]/gi,
  )].map((match) => ({ number: Number(match[1]), url: match[2] }));
  if (!episodes.length) {
    for (const match of html.matchAll(
      /class=['"]numerando['"]>\s*\d+\s*-\s*(\d+)\s*<\/div>[\s\S]{0,500}?href=['"](https:\/\/topanimes\.net\/episodio\/[^'"]+)['"]/gi,
    )) {
      episodes.push({ number: Number(match[1]), url: match[2] });
    }
  }
  const selected = sourceSlug === 'bleach-sennen-kessen-hen'
    ? episodes.filter((episode) => !/-\d+-2\/$/.test(episode.url))
    : episodes;
  if (!selected.length) throw new Error(`${url} não listou episódios`);
  for (const episode of selected) {
    const parsed = new URL(episode.url);
    if (
      parsed.hostname !== 'topanimes.net' ||
      !parsed.pathname.startsWith(`/episodio/${sourceSlug}-episodio-`)
    ) {
      throw new Error(`Link inesperado no catálogo: ${episode.url}`);
    }
  }
  return selected;
}

async function meusCatalog(sourceSlug, pageSlug) {
  const url = `https://meusanimes.blog/a/${pageSlug}/`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'AnimesIceCatalogRepair/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} retornou HTTP ${response.status}`);
  const html = await response.text();
  const episodes = [...html.matchAll(
    new RegExp(`href=['"]https:\\/\\/meusanimes\\.blog\\/e\\/${sourceSlug}-episodio-(\\d+)\\/?['"]`, 'gi'),
  )].map((match) => ({
    number: Number(match[1]),
    url: `https://meusanimes.blog/e/${sourceSlug}-episodio-${match[1]}/`,
  }));
  if (!episodes.length) throw new Error(`${url} não lista ${sourceSlug}`);
  return episodes;
}

async function animesonlineEpisodes() {
  const episodes = [];
  for (let number = 1; number <= 13; number += 1) {
    const padded = String(number).padStart(2, '0');
    const url = `https://animesonline.cloud/episodio/bleach-sennen-kessen-hen-episodio-${padded}`;
    const response = await fetch(url, {
      headers: { 'user-agent': 'AnimesIceCatalogRepair/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await response.text();
    const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ?? '';
    if (!response.ok || !/Bleach Sennen Kessen-hen Epis[oó]dio/i.test(title)) {
      throw new Error(`Episódio do AnimesOnline não corresponde: ${url}`);
    }
    episodes.push({ number, url });
  }
  return episodes;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const plans = [];
    for (const target of TARGETS) {
      const anime = await prisma.anime.findUnique({
        where: { slug: target.slug },
        select: { id: true, slug: true, title: true, audio: true },
      });
      if (!anime) throw new Error(`Anime ausente: ${target.slug}`);
      const episodes = await catalog(target.sourceSlug);
      const additionalSources = [];
      if (target.meusSourceSlug) {
        additionalSources.push({ sourceId: 'meusanimes', episodes: await meusCatalog(target.meusSourceSlug, target.meusPageSlug) });
      }
      if (target.animesonline) {
        additionalSources.push({ sourceId: 'animesonline', episodes: await animesonlineEpisodes() });
      }
      const existing = await prisma.episode.findMany({
        where: { animeId: anime.id, season: 1 },
        select: { number: true, sources: { select: { sourceId: true } } },
      });
      const byNumber = new Map(existing.map((episode) => [episode.number, episode]));
      plans.push({
        anime,
        sourceSlug: target.sourceSlug,
        episodes,
        additionalSources,
        missingEpisodes: episodes.filter((episode) => !byNumber.has(episode.number)).length,
        sourceLinksAdded: [
          ['topanimes', episodes],
          ...additionalSources.map((source) => [source.sourceId, source.episodes]),
        ].reduce((total, [sourceId, links]) => total + links.filter(
          (episode) => !byNumber.get(episode.number)?.sources.some((source) => source.sourceId === sourceId),
        ).length, 0),
      });
    }
    console.log(JSON.stringify({
      apply: APPLY,
      plans: plans.map(({ anime, episodes, missingEpisodes, sourceLinksAdded }) => ({
        slug: anime.slug,
        title: anime.title,
        listedEpisodes: episodes.length,
        missingEpisodes,
        sourceLinksAdded,
      })),
    }));
    if (!APPLY) return;

    const warAnime = plans.find((plan) => plan.anime.slug === 'bleach-2')?.anime;
    if (warAnime) {
      await prisma.episodeSource.deleteMany({ where: { episode: { animeId: warAnime.id } } });
      await prisma.episode.updateMany({
        where: { animeId: warAnime.id },
        data: { videoUrl: null, embedUrl: null, sourceId: null, videoBroken: true },
      });
      await prisma.episode.deleteMany({
        where: { animeId: warAnime.id, number: { gt: 13 } },
      });
      await prisma.animeSource.deleteMany({
        where: { animeId: warAnime.id, sourceId: { not: 'topanimes' } },
      });
      await prisma.anime.update({
        where: { id: warAnime.id },
        data: {
          title: 'Bleach: Guerra Sangrenta dos Mil Anos',
          episodeCount: 13,
          externalUrl: 'https://topanimes.net/animes/bleach-sennen-kessen-hen/',
          externalSource: 'topanimes',
        },
      });
    }

    for (const plan of plans) {
      await prisma.animeSource.upsert({
        where: { animeId_sourceId: { animeId: plan.anime.id, sourceId: 'topanimes' } },
        update: {
          externalKey: plan.sourceSlug,
          externalUrl: `https://topanimes.net/animes/${plan.sourceSlug}/`,
          audio: plan.anime.audio,
          confidence: 1,
          verifiedAt: new Date(),
          lastError: null,
        },
        create: {
          animeId: plan.anime.id,
          sourceId: 'topanimes',
          externalKey: plan.sourceSlug,
          externalUrl: `https://topanimes.net/animes/${plan.sourceSlug}/`,
          audio: plan.anime.audio,
          confidence: 1,
          verifiedAt: new Date(),
        },
      });

      const operations = [];
      for (const episode of plan.episodes) {
        const row = await prisma.episode.upsert({
          where: {
            animeId_season_number: {
              animeId: plan.anime.id,
              season: 1,
              number: episode.number,
            },
          },
          update: {},
          create: {
            id: randomUUID(),
            animeId: plan.anime.id,
            season: 1,
            number: episode.number,
            title: `Episódio ${episode.number}`,
            sourceId: 'topanimes',
          },
          select: { id: true },
        });
        operations.push(
          prisma.episodeSource.upsert({
            where: { episodeId_sourceId: { episodeId: row.id, sourceId: 'topanimes' } },
            update: {
              pageUrl: episode.url,
              audio: plan.anime.audio,
              verifiedAt: new Date(),
              lastError: null,
            },
            create: {
              id: randomUUID(),
              episodeId: row.id,
              sourceId: 'topanimes',
              pageUrl: episode.url,
              audio: plan.anime.audio,
              verifiedAt: new Date(),
            },
          }),
        );
        if (operations.length === 50) {
          await prisma.$transaction(operations.splice(0));
        }
      }
      for (const source of plan.additionalSources) {
        for (const episode of source.episodes) {
          const row = await prisma.episode.findUnique({
            where: {
              animeId_season_number: {
                animeId: plan.anime.id,
                season: 1,
                number: episode.number,
              },
            },
            select: { id: true },
          });
          if (!row) continue;
          operations.push(
            prisma.episodeSource.upsert({
              where: { episodeId_sourceId: { episodeId: row.id, sourceId: source.sourceId } },
              update: { pageUrl: episode.url, audio: plan.anime.audio, verifiedAt: new Date(), lastError: null },
              create: {
                id: randomUUID(),
                episodeId: row.id,
                sourceId: source.sourceId,
                pageUrl: episode.url,
                audio: plan.anime.audio,
                verifiedAt: new Date(),
              },
            }),
          );
          if (operations.length === 50) {
            await prisma.$transaction(operations.splice(0));
          }
        }
      }
      if (operations.length) await prisma.$transaction(operations);
      if (plan.anime.slug === 'bleach-2') {
        await prisma.episode.updateMany({
          where: { animeId: plan.anime.id },
          data: { videoBroken: false },
        });
      }
      console.log(JSON.stringify({ repaired: plan.anime.slug, sources: plan.episodes.length }));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
