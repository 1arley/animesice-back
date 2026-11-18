#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg < 0 ? Infinity : Number(process.argv[limitArg + 1]);
const HOST = '65.52.197.161';
const USER = 'iarley';
const PROVIDERS = [
  'animesdigital',
  'animesonline',
  'meusanimes',
  'animesorion',
  'topanimes',
];
const CHECKPOINT_VERSION = 6;
const shardArg = process.argv.indexOf('--shard');
const shardMatch =
  shardArg < 0
    ? ['0/1', '0', '1']
    : (process.argv[shardArg + 1] || '').match(/^(\d+)\/(\d+)$/);
if (
  !shardMatch ||
  Number(shardMatch[1]) >= Number(shardMatch[2]) ||
  Number(shardMatch[2]) < 1
) {
  throw new Error('--shard precisa estar no formato N/TOTAL, por exemplo 0/2');
}
const SHARD_INDEX = Number(shardMatch[1]);
const SHARD_COUNT = Number(shardMatch[2]);
const LOCAL_PORT = 15432 + SHARD_INDEX;
const CHECKPOINT = `/tmp/animesice-episode-source-backfill-v${CHECKPOINT_VERSION}-${SHARD_INDEX}-of-${SHARD_COUNT}.json`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopRequested = false;

process.on('SIGINT', () => {
  stopRequested = true;
});
process.on('SIGTERM', () => {
  stopRequested = true;
});

function readProductionDatabaseUrl() {
  try {
    return execFileSync(
      'ssh',
      [
        '-i',
        `${homedir()}/.ssh/id_azure.pem`,
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=12',
        `${USER}@${HOST}`,
        'docker exec animesice-back-app-1 printenv DATABASE_URL',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    throw new Error('Não foi possível obter a conexão do app remoto via SSH');
  }
}

function readDatabaseContainerIp() {
  try {
    const ip = execFileSync(
      'ssh',
      [
        '-i',
        `${homedir()}/.ssh/id_azure.pem`,
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=12',
        `${USER}@${HOST}`,
        'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" animesice-back-db-1',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) throw new Error();
    return ip;
  } catch {
    throw new Error(
      'Não foi possível identificar o IP interno do banco via SSH',
    );
  }
}

function openTunnel(databaseIp) {
  const child = spawn(
    'ssh',
    [
      '-i',
      `${homedir()}/.ssh/id_azure.pem`,
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      '-N',
      '-L',
      `127.0.0.1:${LOCAL_PORT}:${databaseIp}:5432`,
      `${USER}@${HOST}`,
    ],
    { stdio: 'ignore' },
  );
  child.on('error', () => {});
  return child;
}

function parseMeusanimes(html, sourceSlug) {
  const entries = new Map();
  for (const match of html.matchAll(
    /href=['"](https:\/\/meusanimes\.blog\/e\/[^'"]+-episodio-\d+\/?)["']/gi,
  )) {
    const url = new URL(match[1]);
    const episodeMatch = url.pathname.match(/\/e\/(.+)-episodio-(\d+)\/?$/i);
    if (!episodeMatch) continue;
    const pageSlug = episodeMatch[1];
    let season = 1;
    if (pageSlug !== sourceSlug) {
      const sibling = pageSlug.match(
        new RegExp(`^${escapeRegex(sourceSlug)}-(\\d+)$`),
      );
      if (!sibling) continue;
      season = Number(sibling[1]);
    }
    const episode = Number(episodeMatch[2]);
    if (episode > 0)
      entries.set(`${season}:${episode}`, { season, episode, url: url.href });
  }
  return [...entries.values()];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSeasonCatalog(html, hostname, sourceId) {
  const entries = new Map();
  const re = /class=['"]numerando['"]>\s*(\d+)\s*-\s*(\d+)\s*<\/div>/gi;
  const matches = [...html.matchAll(re)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const start = (match.index ?? 0) + match[0].length;
    const end = next?.index ?? Math.min(html.length, start + 1500);
    const block = html.slice(start, end);
    const href = block.match(/<a\b[^>]*href=['"](https:\/\/[^'"]+)['"]/i)?.[1];
    if (!href) continue;
    const season = Number(match[1]);
    const episode = Number(match[2]);
    let url;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== hostname ||
      season < 1 ||
      episode < 1
    )
      continue;
    if (sourceId === 'topanimes') {
      const parsed = url.pathname.match(
        /^\/episodio\/[^/]+-episodio-0*(\d+)\/?$/i,
      );
      if (!parsed || Number(parsed[1]) !== episode) continue;
    } else if (sourceId === 'animesorion') {
      const parsed = url.pathname.match(/\/([^/]+)-(\d+)x(\d+)\/?$/i);
      if (
        !parsed ||
        Number(parsed[2]) !== season ||
        Number(parsed[3]) !== episode
      )
        continue;
    } else {
      continue;
    }
    entries.set(`${season}:${episode}`, { season, episode, url: url.href });
  }
  return [...entries.values()];
}

function catalogUrl(mapping) {
  const url = new URL(mapping.externalUrl);
  const allowed = {
    meusanimes: ['meusanimes.blog'],
    animesorion: ['animexhd.xyz', 'animesorion.cc'],
    topanimes: ['topanimes.net'],
    animesonline: ['animesonline.cloud', 'animesonlinecc.to'],
    animesdigital: ['animesdigital.org'],
  }[mapping.sourceId];
  if (!allowed?.includes(url.hostname) || url.protocol !== 'https:')
    return null;
  const keyPattern = {
    meusanimes: /^\/a\/([^/]+)\/?$/i,
    animesdigital: /^\/anime\/a\/([^/]+)\/?$/i,
    animesonline: /^\/anime\/([^/]+)\/?$/i,
    animesorion: /^\/animes\/([^/]+)\/?$/i,
    topanimes: /^\/animes\/([^/]+)\/?$/i,
  }[mapping.sourceId];
  let key;
  try {
    key = decodeURIComponent(url.pathname.match(keyPattern)?.[1] ?? '');
  } catch {
    return null;
  }
  if (
    !mapping.externalKey?.trim() ||
    key.toLowerCase() !== mapping.externalKey.trim().toLowerCase()
  )
    return null;
  return url;
}

function parseOnlineCatalog(html, mapping, hostname) {
  const sourceSlug = mapping.externalKey?.trim();
  if (!sourceSlug) return [];
  const entries = new Map();
  for (const match of html.matchAll(/href=['"](https:\/\/[^'"]+)['"]/gi)) {
    let url;
    try {
      url = new URL(match[1]);
    } catch {
      continue;
    }
    if (url.hostname !== hostname) continue;
    const parsed = url.pathname.match(
      /^\/(?:episodio\/)?(.+)-episodio-0*(\d+)\/?$/i,
    );
    if (!parsed) continue;
    const pageSlug = parsed[1];
    let season = 1;
    if (pageSlug !== sourceSlug) {
      const sibling = pageSlug.match(
        new RegExp(`^${escapeRegex(sourceSlug)}-(\\d+)$`),
      );
      if (!sibling) continue;
      season = Number(sibling[1]);
    }
    const episode = Number(parsed[2]);
    if (episode > 0)
      entries.set(`${season}:${episode}`, { season, episode, url: url.href });
  }
  return [...entries.values()];
}

function parseDigitalCatalog(html) {
  const entries = new Map();
  const cardRe =
    /<a\s+href=['"](https:\/\/animesdigital\.org\/video\/a\/\d+)\/?['"][^>]*>((?:(?!<a[\s>])[\s\S]){0,1200}?)<\/a>/gi;
  for (const match of html.matchAll(cardRe)) {
    const episode = Number(match[2].match(/Epis[oó]dio\s*0*(\d{1,4})/i)?.[1]);
    if (episode > 0)
      entries.set(episode, { season: 1, episode, url: match[1] });
  }
  return [...entries.values()];
}

async function getHtml(url, expectedHost) {
  await sleep(750);
  const response = await fetch(url, {
    headers: { 'user-agent': 'AnimesIceEpisodeSourceBackfill/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const finalUrl = new URL(response.url);
  if (
    finalUrl.protocol !== 'https:' ||
    finalUrl.hostname !== expectedHost ||
    finalUrl.pathname.replace(/\/+$/, '') !==
      new URL(url).pathname.replace(/\/+$/, '')
  ) {
    throw new Error('Redirecionamento para host inesperado');
  }
  return response.text();
}

async function fetchEntries(mapping, targetSeason) {
  const url = catalogUrl(mapping);
  if (!url) return [];
  const html = await getHtml(url, url.hostname);
  if (mapping.sourceId === 'meusanimes') {
    return parseMeusanimes(
      html,
      mapping.externalKey || url.pathname.split('/').filter(Boolean).at(-1),
    );
  }
  if (mapping.sourceId === 'animesonline') {
    return parseOnlineCatalog(html, mapping, url.hostname);
  }
  if (mapping.sourceId === 'animesdigital') {
    const slug = url.pathname.match(/\/anime\/a\/([^/]+)/)?.[1];
    if (!slug) return [];
    const entries = new Map();
    let pageUrl = url;
    for (let page = 1; page <= 20; page += 1) {
      const pageHtml = page === 1 ? html : await getHtml(pageUrl, url.hostname);
      for (const entry of parseDigitalCatalog(pageHtml))
        entries.set(entry.episode, entry);
      const nextPage = [
        ...pageHtml.matchAll(/\/anime\/a\/([^"'#?\s]+)\/page\/(\d+)/g),
      ]
        .map((match) => ({ slug: match[1], page: Number(match[2]) }))
        .find((match) => match.slug === slug && match.page > page);
      if (!nextPage) break;
      pageUrl = new URL(`/anime/a/${slug}/page/${nextPage.page}`, url.origin);
    }
    return [...entries.values()].map((entry) => ({
      ...entry,
      season: targetSeason,
    }));
  }
  return parseSeasonCatalog(html, url.hostname, mapping.sourceId);
}

async function fetchEntriesWithRetry(mapping, targetSeason) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchEntries(mapping, targetSeason);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function databaseWithRetry(operation, assertTunnel) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assertTunnel();
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function readCheckpoint() {
  const empty = () => ({
    version: CHECKPOINT_VERSION,
    lastSlug: '',
    processed: 0,
    writes: 0,
    failures: 0,
    failedMappings: [],
    retryMode: false,
  });
  if (!existsSync(CHECKPOINT)) return empty();
  try {
    const state = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
    return state.version === CHECKPOINT_VERSION &&
      Array.isArray(state.failedMappings)
      ? state
      : empty();
  } catch {
    return empty();
  }
}

function saveCheckpoint(state) {
  const temp = `${CHECKPOINT}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state));
  renameSync(temp, CHECKPOINT);
}

async function main() {
  if (limitArg >= 0 && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
    throw new Error('--limit precisa ser um inteiro positivo');
  }
  const databaseUrl = new URL(readProductionDatabaseUrl());
  databaseUrl.hostname = '127.0.0.1';
  databaseUrl.port = String(LOCAL_PORT);
  const tunnel = openTunnel(readDatabaseContainerIp());
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
  pool.on('error', () => {});
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  let state = APPLY
    ? readCheckpoint()
    : {
        version: CHECKPOINT_VERSION,
        lastSlug: '',
        processed: 0,
        writes: 0,
        failures: 0,
        failedMappings: [],
        retryMode: false,
      };
  const assertTunnel = () => {
    if (tunnel.exitCode !== null)
      throw new Error('Túnel SSH caiu; o checkpoint preserva a retomada');
  };
  try {
    let connected = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        connected = true;
        break;
      } catch {
        await sleep(500);
      }
    }
    if (!connected)
      throw new Error('Túnel SSH abriu, mas o banco não respondeu');

    const animes = await databaseWithRetry(
      () =>
        prisma.anime.findMany({
          where: {
            sourceMappings: {
              some: { sourceId: { in: PROVIDERS } },
            },
          },
          select: {
            id: true,
            slug: true,
            audio: true,
            episodes: {
              select: {
                id: true,
                number: true,
                season: true,
                sources: { select: { sourceId: true } },
              },
            },
            sourceMappings: {
              where: { sourceId: { in: PROVIDERS } },
              select: {
                sourceId: true,
                externalKey: true,
                externalUrl: true,
                audio: true,
              },
              orderBy: { sourceId: 'asc' },
            },
          },
          orderBy: { slug: 'asc' },
        }),
      assertTunnel,
    );
    const eligible = animes.filter(
      (anime) =>
        anime.sourceMappings.filter((mapping) => mapping.audio === anime.audio)
          .length >= 2 &&
        anime.episodes.some((episode) => episode.sources.length < 2),
    );
    const partition = eligible.filter(
      (_, index) => index % SHARD_COUNT === SHARD_INDEX,
    );
    const retryMappings = state.failedMappings.filter(
      (item) => item.attempts < 3,
    );
    const retryMode = APPLY && state.retryMode && retryMappings.length > 0;
    const retrySlugs = new Set(retryMappings.map((item) => item.slug));
    const candidates = (
      retryMode
        ? partition.filter((anime) => retrySlugs.has(anime.slug))
        : partition.filter((anime) => anime.slug > state.lastSlug)
    ).slice(0, LIMIT);
    console.log(
      JSON.stringify({
        mode: APPLY ? 'apply' : 'dry-run',
        eligibleAnime: eligible.length,
        shard: `${SHARD_INDEX}/${SHARD_COUNT}`,
        shardAnime: partition.length,
        remaining: partition.filter((anime) => anime.slug > state.lastSlug)
          .length,
        retryMode,
        processing: candidates.length,
        checkpoint: state.lastSlug || null,
      }),
    );

    for (const anime of candidates) {
      if (stopRequested) break;
      try {
        assertTunnel();
        let writesForAnime = 0;
        const episodes = anime.episodes;
        const validMappings = anime.sourceMappings.filter(
          (mapping) =>
            mapping.audio === anime.audio &&
            catalogUrl(mapping) &&
            (!retryMode ||
              retryMappings.some(
                (failed) =>
                  failed.slug === anime.slug &&
                  failed.sourceId === mapping.sourceId,
              )),
        );
        const plans = [];
        for (const mapping of validMappings) {
          try {
            assertTunnel();
            const sibling = anime.slug.match(/-(\d+)$/);
            const suffixSeason = sibling ? Number(sibling[1]) : 1;
            const baseSlug = sibling
              ? anime.slug.slice(0, -sibling[0].length)
              : '';
            const splitSeason =
              suffixSeason > 1 && mapping.externalKey === baseSlug;
            if (
              mapping.sourceId === 'animesdigital' &&
              (splitSeason || episodes.some((episode) => episode.season > 1))
            ) {
              console.log(
                JSON.stringify({
                  slug: anime.slug,
                  sourceId: mapping.sourceId,
                  skipped: 'a listagem não informa temporada com segurança',
                }),
              );
              continue;
            }
            const parsedEntries = await fetchEntriesWithRetry(
              mapping,
              splitSeason ? suffixSeason : 1,
            );
            const entries = splitSeason
              ? parsedEntries.filter((entry) => entry.season === suffixSeason)
              : parsedEntries;
            const bySeasonAndNumber = new Map(
              episodes.map((episode) => [
                `${episode.season}:${episode.number}`,
                episode,
              ]),
            );
            const additions = entries.flatMap((entry) => {
              const exact = bySeasonAndNumber.get(
                `${entry.season}:${entry.episode}`,
              );
              const splitLocal =
                splitSeason && entry.season === suffixSeason
                  ? episodes.filter(
                      (episode) =>
                        episode.season === 1 &&
                        episode.number === entry.episode,
                    )
                  : [];
              const episode =
                exact ?? (splitLocal.length === 1 ? splitLocal[0] : undefined);
              if (
                !episode ||
                episode.sources.some(
                  (source) => source.sourceId === mapping.sourceId,
                )
              )
                return [];
              return [
                {
                  episodeId: episode.id,
                  sourceId: mapping.sourceId,
                  pageUrl: entry.url,
                },
              ];
            });
            plans.push({ sourceId: mapping.sourceId, additions });
            state.failedMappings = state.failedMappings.filter(
              (failed) =>
                failed.slug !== anime.slug ||
                failed.sourceId !== mapping.sourceId,
            );
            let sourceLinksWritten = additions.length;
            if (APPLY) {
              if (additions.length) {
                assertTunnel();
                const result = await databaseWithRetry(
                  () =>
                    prisma.episodeSource.createMany({
                      data: additions.map((row) => ({
                        ...row,
                        id: randomUUID(),
                        audio: anime.audio,
                      })),
                      skipDuplicates: true,
                    }),
                  assertTunnel,
                );
                sourceLinksWritten = result.count;
              }
              writesForAnime += sourceLinksWritten;
            }
            console.log(
              JSON.stringify({
                slug: anime.slug,
                sourceId: mapping.sourceId,
                catalogEpisodes: entries.length,
                sourceLinksAdded: sourceLinksWritten,
              }),
            );
          } catch (error) {
            assertTunnel();
            state.failures += 1;
            const failed = state.failedMappings.find(
              (item) =>
                item.slug === anime.slug && item.sourceId === mapping.sourceId,
            );
            if (failed) {
              failed.attempts += 1;
              failed.error = error.message;
            } else {
              state.failedMappings.push({
                slug: anime.slug,
                sourceId: mapping.sourceId,
                attempts: 1,
                error: error.message,
              });
            }
            console.log(
              JSON.stringify({
                slug: anime.slug,
                sourceId: mapping.sourceId,
                retry: state.failedMappings.find(
                  (item) =>
                    item.slug === anime.slug &&
                    item.sourceId === mapping.sourceId,
                )?.attempts,
                error: error.message,
              }),
            );
          }
        }
        state.writes += APPLY
          ? writesForAnime
          : plans.reduce((total, plan) => total + plan.additions.length, 0);
      } catch (error) {
        assertTunnel();
        state.failures += 1;
        console.log(JSON.stringify({ slug: anime.slug, error: error.message }));
      }
      state.lastSlug = anime.slug;
      state.processed += 1;
      if (APPLY) saveCheckpoint(state);
    }
    const passComplete = !stopRequested && candidates.length < LIMIT;
    const retryableFailures = state.failedMappings.filter(
      (item) => item.attempts < 3,
    ).length;
    const scheduleRetry = APPLY && passComplete && retryableFailures > 0;
    if (scheduleRetry) {
      state.retryMode = true;
      state.lastSlug = '';
      saveCheckpoint(state);
      process.exitCode = 2;
    } else if (retryMode && passComplete) {
      state.retryMode = false;
      state.lastSlug = partition.at(-1)?.slug ?? state.lastSlug;
      saveCheckpoint(state);
    }
    const complete = passComplete && !scheduleRetry;
    console.log(
      JSON.stringify({
        complete,
        stopped: stopRequested,
        retryMode,
        retryableFailures,
        exhaustedFailures: state.failedMappings.filter(
          (item) => item.attempts >= 3,
        ).length,
        shard: `${SHARD_INDEX}/${SHARD_COUNT}`,
        ...state,
      }),
    );
  } finally {
    try {
      await prisma.$disconnect();
    } finally {
      try {
        await pool.end();
      } finally {
        tunnel.kill('SIGTERM');
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
