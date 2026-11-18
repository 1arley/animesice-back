#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AudioType, PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const HOST = 'meusanimes.blog';
const INDEX_URL = `https://${HOST}/sitemap_index.xml`;
const UA = 'AnimesIceCatalogBackfill/1.0';
const SCAN_CATALOG = 'SCAN_CATALOG';
const APPLY = process.argv.includes('--apply');
const limitIndex = process.argv.indexOf('--limit');
const LIMIT = limitIndex < 0 ? Infinity : Number(process.argv[limitIndex + 1]);

function locations(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
    match[1].trim(),
  );
}

async function fetchXml(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== HOST) {
    throw new Error(`Sitemap fora da fonte esperada: ${url}`);
  }
  const response = await fetch(url, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} retornou HTTP ${response.status}`);
  return response.text();
}

function slugFromPage(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== HOST) return null;
  const match = parsed.pathname.match(/^\/a\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]).toLowerCase();
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

function dubladoTitle(title) {
  return `${title.replace(/[\s(-]*(?:legendado|dublado)[\s)-]*$/i, '').trim()} Dublado`;
}

async function discover() {
  const index = await fetchXml(INDEX_URL);
  const maps = locations(index).filter((url) => {
    const parsed = new URL(url);
    return (
      parsed.hostname === HOST &&
      /\/tvshows-sitemap\d*\.xml$/i.test(parsed.pathname)
    );
  });
  if (maps.length === 0) throw new Error('Sitemap não lista mapas de séries');

  const slugs = new Set();
  for (const map of maps) {
    for (const url of locations(await fetchXml(map))) {
      const slug = slugFromPage(url);
      if (slug) slugs.add(slug);
    }
  }
  return [...slugs].sort().slice(0, LIMIT);
}

async function main() {
  if (limitIndex >= 0 && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
    throw new Error('--limit precisa ser um inteiro positivo');
  }

  const slugs = await discover();
  if (!process.env.DATABASE_URL) {
    if (APPLY) throw new Error('DATABASE_URL ausente');
    console.log(
      JSON.stringify({
        source: HOST,
        found: slugs.length,
        sample: slugs.slice(0, 8),
        databaseChecked: false,
      }),
    );
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const existing = await prisma.anime.findMany({
      where: { slug: { in: slugs } },
      select: {
        id: true,
        slug: true,
        title: true,
        audio: true,
        sourceMappings: {
          where: { sourceId: 'meusanimes' },
          select: { id: true },
        },
      },
    });
    const alreadyDubbed = await prisma.anime.findMany({
      where: { audio: AudioType.DUBLADO },
      select: { id: true, slug: true, title: true, audio: true },
    });
    const existingBySlug = new Map(
      existing.map((anime) => [anime.slug, anime]),
    );
    const missingAnime = slugs.filter((slug) => !existingBySlug.has(slug));
    const missingMappings = slugs.filter(
      (slug) => !existingBySlug.get(slug)?.sourceMappings.length,
    );
    const dubladoCandidates = new Map(
      [
        ...alreadyDubbed,
        ...existing.filter((anime) => /(^|-)dublado($|-)/i.test(anime.slug)),
      ].map((anime) => [anime.id, anime]),
    );
    const dubladoFixes = [...dubladoCandidates.values()].flatMap((anime) => {
      const title = dubladoTitle(anime.title);
      return anime.audio !== AudioType.DUBLADO || anime.title !== title
        ? [{ id: anime.id, title }]
        : [];
    });

    console.log(
      JSON.stringify({
        source: HOST,
        found: slugs.length,
        existingAnime: existing.length,
        newAnime: missingAnime.length,
        newSourceMappings: missingMappings.length,
        dubladoFixes: dubladoFixes.length,
        apply: APPLY,
        sample: slugs.slice(0, 8),
      }),
    );
    if (!APPLY) return;

    for (let offset = 0; offset < missingAnime.length; offset += 500) {
      const batch = missingAnime.slice(offset, offset + 500);
      await prisma.anime.createMany({
        data: batch.map((slug) => ({
          id: randomUUID(),
          slug,
          title: titleFromSlug(slug),
          audio: /(^|-)dublado($|-)/i.test(slug)
            ? AudioType.DUBLADO
            : AudioType.LEGENDADO,
          published: false,
        })),
        skipDuplicates: true,
      });
    }

    const animeRows = await prisma.anime.findMany({
      where: { slug: { in: slugs } },
      select: {
        id: true,
        slug: true,
        sourceMappings: {
          where: { sourceId: 'meusanimes' },
          select: { id: true },
        },
      },
    });
    const mappings = animeRows
      .filter((anime) => !anime.sourceMappings.length)
      .map((anime) => ({
        id: randomUUID(),
        animeId: anime.id,
        sourceId: 'meusanimes',
        externalKey: anime.slug,
        externalUrl: `https://${HOST}/a/${anime.slug}/`,
        audio: /(^|-)dublado($|-)/i.test(anime.slug)
          ? AudioType.DUBLADO
          : AudioType.LEGENDADO,
        confidence: 0.9,
      }));
    for (let offset = 0; offset < mappings.length; offset += 500) {
      await prisma.animeSource.createMany({
        data: mappings.slice(offset, offset + 500),
        skipDuplicates: true,
      });
    }

    for (const fix of dubladoFixes) {
      await prisma.anime.update({
        where: { id: fix.id },
        data: { title: fix.title, audio: AudioType.DUBLADO },
      });
    }
    let scanJobsQueued = 0;
    for (let offset = 0; offset < animeRows.length; offset += 500) {
      const batch = animeRows.slice(offset, offset + 500);
      const result = await prisma.watchtowerJob.createMany({
        data: batch.map((anime) => ({
          type: SCAN_CATALOG,
          dedupeKey: `scan-catalog:${anime.id}`,
          payload: { animeId: anime.id, slug: anime.slug },
          priority: 75,
        })),
        skipDuplicates: true,
      });
      scanJobsQueued += result.count;
    }
    console.log(
      JSON.stringify({
        insertedAnime: missingAnime.length,
        insertedSourceMappings: mappings.length,
        fixedDubladoTitles: dubladoFixes.length,
        scanJobsQueued,
        published: false,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
