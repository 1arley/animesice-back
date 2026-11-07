#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const PROVIDERS = [
  'animesdigital',
  'animesonline',
  'meusanimes',
  'animesorion',
  'topanimes',
];
const HOSTS = {
  animesdigital: ['animesdigital.org'],
  animesonline: ['animesonline.cloud', 'animesonlinecc.to'],
  meusanimes: ['meusanimes.blog'],
  animesorion: ['animesorion.cc'],
  topanimes: ['topanimes.net'],
};
const VERSION = 2;
const apply = process.argv.includes('--apply');
const showLinks = process.argv.includes('--show-links');
const shardArg = process.argv.indexOf('--shard');
const shard = shardArg < 0 ? '0/1' : process.argv[shardArg + 1];
const shardMatch = shard?.match(/^(\d+)\/(\d+)$/);
if (
  !shardMatch ||
  Number(shardMatch[1]) >= Number(shardMatch[2]) ||
  Number(shardMatch[2]) > 4
) {
  throw new Error('--shard deve estar no formato N/TOTAL, com TOTAL até 4');
}
const shardIndex = Number(shardMatch[1]);
const shardCount = Number(shardMatch[2]);
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg < 0 ? Infinity : Number(process.argv[limitArg + 1]);
if ((!Number.isInteger(limit) && limit !== Infinity) || limit < 1) {
  throw new Error('--limit deve ser um inteiro positivo');
}
const checkpointPath = `/tmp/animesice-source-discovery-v${VERSION}-${shardIndex}-of-${shardCount}.json`;
const USER = 'iarley';
const SERVER = '65.52.197.161';
const PORT = 15520 + shardIndex;
const UA = 'AnimesIceCatalogMappingDiscovery/1.0';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});

function readRemote(command) {
  return execFileSync(
    'ssh',
    [
      '-i',
      `${homedir()}/.ssh/id_azure.pem`,
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=12',
      `${USER}@${SERVER}`,
      command,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
}

function startTunnel(ip) {
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
      `127.0.0.1:${PORT}:${ip}:5432`,
      `${USER}@${SERVER}`,
    ],
    { stdio: 'ignore' },
  );
  child.on('error', () => {});
  return child;
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    if (state.version === VERSION && Array.isArray(state.done)) {
      return { ...state, retries: state.retries ?? {} };
    }
  } catch {}
  return {
    version: VERSION,
    done: [],
    retries: {},
    mapped: 0,
    episodeLinks: 0,
    errors: 0,
  };
}

function saveState(state) {
  const tmp = `${checkpointPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, checkpointPath);
}

function cleanText(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleTokens(value) {
  return new Set(
    cleanText(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(
        (word) =>
          (word.length > 1 || /^\d+$/.test(word)) &&
          !new Set([
            'the',
            'and',
            'for',
            'with',
            'from',
            'online',
            'assistir',
            'anime',
            'animes',
            'dublado',
            'dublada',
            'dub',
            'legendado',
            'legendada',
            'sub',
            'subbed',
            'todos',
            'episodios',
            'episodio',
            'temporada',
            'season',
            'seasons',
            'ptbr',
            'portugues',
            'watch',
            'site',
            'top',
            'meus',
            'digital',
            'orion',
          ]).has(word),
      ),
  );
}

function animeTitles(anime, includeSeasonBase = false) {
  const stripSeason = (value) =>
    value
      .replace(/\b(?:season|temporada)\s*\d+\b/gi, ' ')
      .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi, ' ')
      .replace(/\s+\d+\s*$/g, ' ')
      .replace(/\b(?:dublado|dublada|legendado|legendada)\b/gi, ' ');
  return [
    ...new Set(
      [anime.title, anime.japaneseTitle, ...anime.alternativeTitles]
        .filter(Boolean)
        .flatMap((title) =>
          includeSeasonBase ? [title, stripSeason(title)] : [title],
        ),
    ),
  ];
}

function matchesTitle(anime, candidates, includeSeasonBase = false) {
  return candidates.some((candidate) => {
    const candidateTokens = titleTokens(candidate);
    if (!candidateTokens.size) return false;
    return animeTitles(anime, includeSeasonBase).some((title) => {
      const titleSet = titleTokens(title);
      return (
        titleSet.size === candidateTokens.size &&
        [...titleSet].every((word) => candidateTokens.has(word))
      );
    });
  });
}

function audioMatches(anime, texts) {
  const sourceText = texts
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(
      /\b(?:legendado\s+ou\s+dublado|dublado\s+ou\s+legendado)\b/gi,
      ' ',
    );
  const dubbed = /\b(dublado|dublada|dub|portugues|pt\s*br|ptbr)\b/i.test(
    sourceText,
  );
  const subbed = /\b(legendado|legendada|leg|subbed|subtitulado)\b/i.test(
    sourceText,
  );
  if (dubbed === subbed) return false;
  return anime.audio === 'DUBLADO' ? dubbed : subbed;
}

assert.equal(
  audioMatches({ audio: 'DUBLADO' }, ['Bleach Legendado ou Dublado']),
  false,
);
assert.equal(audioMatches({ audio: 'DUBLADO' }, ['Bleach Dublado']), true);
assert.equal(audioMatches({ audio: 'LEGENDADO' }, ['Bleach']), false);
assert.equal(audioMatches({ audio: 'LEGENDADO' }, ['Bleach Legendado']), true);
assert.equal(
  audioMatches({ audio: 'DUBLADO' }, ['Bleach Dublado Legendado']),
  false,
);

function extractTitleHints(html) {
  const values = [];
  for (const re of [
    /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)/gi,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:title["']/gi,
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi,
    /<title\b[^>]*>([\s\S]*?)<\/title>/gi,
  ]) {
    for (const match of html.matchAll(re)) {
      const value = cleanText(match[1]);
      if (value && !values.includes(value)) values.push(value);
    }
  }
  return values;
}

function mappingUrl(sourceId, key) {
  const slug = encodeURIComponent(key);
  return {
    meusanimes: `https://meusanimes.blog/a/${slug}/`,
    animesdigital: `https://animesdigital.org/anime/a/${slug}`,
    animesonline: `https://animesonline.cloud/anime/${slug}/`,
    animesorion: `https://animesorion.cc/animes/${slug}/`,
    topanimes: `https://topanimes.net/animes/${slug}/`,
  }[sourceId];
}

function catalogKeyFromUrl(value, sourceId) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    !HOSTS[sourceId]?.includes(url.hostname) ||
    url.username ||
    url.password
  )
    return null;
  const path = url.pathname.replace(/\/+$/, '');
  const key =
    sourceId === 'meusanimes'
      ? path.match(/^\/a\/([^/]+)$/i)?.[1]
      : sourceId === 'animesdigital'
        ? path.match(/^\/anime\/a\/([^/]+)$/i)?.[1]
        : sourceId === 'animesonline'
          ? path.match(/^\/anime\/([^/]+)$/i)?.[1]
          : path.match(/^\/animes\/([^/]+)$/i)?.[1];
  try {
    return key ? decodeURIComponent(key).toLowerCase() : null;
  } catch {
    return null;
  }
}

function sameCatalogIdentity(value, sourceId, key) {
  return catalogKeyFromUrl(value, sourceId) === String(key ?? '').toLowerCase();
}

assert(
  sameCatalogIdentity(
    'https://animesonline.cloud/anime/bleach-sennen-kessen-hen/',
    'animesonline',
    'bleach-sennen-kessen-hen',
  ),
);
assert(
  !sameCatalogIdentity(
    'https://animesonline.cloud/anime/bleach-sennen-kessen-hen-soukoku-tan-dublado',
    'animesonline',
    'bleach-sennen-kessen-hen',
  ),
);

function candidateKeys(anime, existingMappings) {
  const values = [];
  const add = (value) => {
    const key = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/^\/+|\/+$/g, '');
    if (key && /^[a-z0-9-]+$/.test(key) && !values.includes(key))
      values.push(key);
  };
  for (const mapping of existingMappings) add(mapping.externalKey);
  add(anime.slug);
  add(anime.slug.replace(/-(?:dublado|legendado)$/i, ''));
  add(anime.slug.replace(/-(?:dublado|legendado)-\d+$/i, ''));
  if (/(?:^|-)\d{1,2}$/.test(anime.slug))
    add(anime.slug.replace(/-\d{1,2}$/, ''));
  for (const title of animeTitles(anime)) {
    add(
      title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    );
  }
  return values.slice(0, 4);
}

function sourceLinks(html, sourceId) {
  const found = [];
  for (const match of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    let url;
    try {
      url = new URL(decodeHtml(match[1]));
    } catch {
      continue;
    }
    if (!HOSTS[sourceId].includes(url.hostname)) continue;
    const path = url.pathname.replace(/\/+$/, '');
    let key = null;
    if (sourceId === 'meusanimes') key = path.match(/^\/a\/([^/]+)$/i)?.[1];
    if (sourceId === 'animesdigital')
      key = path.match(/^\/anime\/a\/([^/]+)$/i)?.[1];
    if (sourceId === 'animesonline')
      key = path.match(/^\/anime\/([^/]+)$/i)?.[1];
    if (sourceId === 'animesorion' || sourceId === 'topanimes')
      key = path.match(/^\/animes\/([^/]+)$/i)?.[1];
    if (!key || ['anime', 'animes', 'a', 'page'].includes(key)) continue;
    const title = cleanText(match[2]);
    url.search = '';
    url.hash = '';
    found.push({ key, url: url.href, title, host: url.hostname });
  }
  return [...new Map(found.map((item) => [item.key, item])).values()];
}

async function fetchHtml(url, sourceId) {
  await sleep(450);
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  const finalUrl = new URL(response.url);
  if (
    finalUrl.protocol !== 'https:' ||
    !HOSTS[sourceId].includes(finalUrl.hostname) ||
    finalUrl.username ||
    finalUrl.password
  )
    throw new Error('redirect host rejected');
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`provider HTTP ${response.status}`);
  }
  if (!response.ok) return null;
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 3_000_000) throw new Error('catalog response too large');
  const html = await response.text();
  if (html.length > 3_000_000) throw new Error('catalog response too large');
  if (
    /cf-chl-|just a moment|checking your browser/i.test(html) &&
    html.length < 30_000
  ) {
    throw new Error('provider challenge page');
  }
  return { html, finalUrl };
}

function parseCatalogEntries(html, sourceId, sourceKey, fallbackSeason) {
  const entries = new Map();
  if (sourceId === 'animesdigital') {
    const card =
      /<a\s+href=["'](https:\/\/animesdigital\.org\/video\/a\/\d+)\/?["'][^>]*>((?:(?!<a[\s>])[\s\S]){0,1200}?)<\/a>/gi;
    for (const match of html.matchAll(card)) {
      const episode = Number(
        cleanText(match[2]).match(/Epis[oó]dio\s*0*(\d{1,4})/i)?.[1],
      );
      if (episode > 0)
        entries.set(`1:${episode}`, {
          season: fallbackSeason,
          episode,
          url: match[1],
        });
    }
    return [...entries.values()];
  }

  const numerando =
    /class=["'][^"']*numerando[^"']*["'][^>]*>\s*(\d+)\s*-\s*(\d+)\s*<\/[^>]+>/gi;
  const markers = [...html.matchAll(numerando)];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const start = (marker.index ?? 0) + marker[0].length;
    const end =
      markers[index + 1]?.index ?? Math.min(html.length, start + 1800);
    const block = html.slice(start, end);
    const href = block.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let url;
    try {
      url = new URL(decodeHtml(href));
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || !HOSTS[sourceId].includes(url.hostname))
      continue;
    const season = Number(marker[1]),
      episode = Number(marker[2]);
    if (sourceId === 'topanimes') {
      const parsed = url.pathname.match(
        /^\/episodio\/[^/]+-episodio-0*(\d+)\/?$/i,
      );
      if (!parsed || Number(parsed[1]) !== episode) continue;
    }
    if (sourceId === 'animesorion') {
      const parsed = url.pathname.match(/\/([^/]+)-(\d+)x(\d+)\/?$/i);
      if (
        !parsed ||
        Number(parsed[2]) !== season ||
        Number(parsed[3]) !== episode
      )
        continue;
    }
    if (season > 0 && episode > 0)
      entries.set(`${season}:${episode}`, { season, episode, url: url.href });
  }

  if (sourceId === 'meusanimes' && markers.length === 0) {
    const re =
      /https:\/\/meusanimes\.blog\/e\/([^\s"'<>]+?)-episodio-0*(\d+)\/?/gi;
    for (const match of html.matchAll(re)) {
      const episode = Number(match[2]);
      const pageKey = match[1].replace(/-episodio-\d+$/i, '');
      const seasonMatch = pageKey.match(
        new RegExp(`^${escapeRegex(sourceKey)}-(\\d+)$`, 'i'),
      );
      const season = seasonMatch ? Number(seasonMatch[1]) : 1;
      if (episode > 0 && season > 0)
        entries.set(`${season}:${episode}`, { season, episode, url: match[0] });
    }
  } else if (sourceId === 'animesonline') {
    const re = /href=["'](https?:\/\/[^"']+)["']/gi;
    for (const match of html.matchAll(re)) {
      let url;
      try {
        url = new URL(decodeHtml(match[1]));
      } catch {
        continue;
      }
      if (!HOSTS[sourceId].includes(url.hostname)) continue;
      const parsed = url.pathname.match(
        /^\/episodio\/(.+?)-episodio-0*(\d+)\/?$/i,
      );
      if (!parsed) continue;
      const episode = Number(parsed[2]);
      let season = 1;
      const sibling = parsed[1].match(
        new RegExp(`^${escapeRegex(sourceKey)}-(\\d+)$`, 'i'),
      );
      if (sibling) season = Number(sibling[1]);
      if (episode > 0 && season > 0)
        entries.set(`${season}:${episode}`, { season, episode, url: url.href });
    }
  }
  return [...entries.values()];
}

function searchUrl(sourceId, query) {
  const q = encodeURIComponent(query);
  return {
    meusanimes: `https://meusanimes.blog/?s=${q}`,
    animesdigital: `https://animesdigital.org/?s=${q}`,
    animesonline: `https://animesonline.cloud/?post_type=eps&s=${q}`,
    animesorion: `https://animesorion.cc/?s=${q}`,
    topanimes: `https://topanimes.net/?s=${q}`,
  }[sourceId];
}

async function discoverForProvider(
  anime,
  sourceId,
  existingMappings,
  requiredSeason,
) {
  const tried = new Set();
  let errors = 0;
  const allowSeasonBase = requiredSeason > 1;
  const validate = async (candidate, page) => {
    if (!page) return null;
    if (!sameCatalogIdentity(page.finalUrl, sourceId, candidate.key))
      return null;
    const titleHints = [
      ...extractTitleHints(page.html),
      candidate.title ?? '',
    ].filter(Boolean);
    if (
      !matchesTitle(anime, titleHints, allowSeasonBase) ||
      !audioMatches(anime, [...titleHints, candidate.key])
    )
      return null;
    // AnimesDigital não inclui temporada nos cards; não é seguro inferi-la.
    if (sourceId === 'animesdigital' && requiredSeason !== 1) return null;
    const entries = parseCatalogEntries(
      page.html,
      sourceId,
      candidate.key,
      requiredSeason,
    ).filter((entry) => entry.season === requiredSeason);
    const findEpisode = (entry) => {
      const exact = anime.episodes.filter(
        (episode) =>
          episode.number === entry.episode && episode.season === entry.season,
      );
      if (exact.length === 1) return exact[0];
      if (
        requiredSeason > 1 &&
        entry.season === requiredSeason &&
        exact.length === 0
      ) {
        const splitSeason = anime.episodes.filter(
          (episode) => episode.number === entry.episode && episode.season === 1,
        );
        if (splitSeason.length === 1) return splitSeason[0];
      }
      return null;
    };
    const additions = entries.flatMap((entry) => {
      const episode = findEpisode(entry);
      if (
        !episode ||
        episode.sources.some((source) => source.sourceId === sourceId)
      )
        return [];
      return [
        {
          episodeId: episode.id,
          sourceId,
          pageUrl: entry.url,
          audio: anime.audio,
        },
      ];
    });
    const matchedExisting = entries.filter((entry) =>
      findEpisode(entry),
    ).length;
    const eligibleEpisodes = anime.episodes.filter(
      (episode) =>
        episode.season === requiredSeason ||
        (requiredSeason > 1 && episode.season === 1),
    );
    if (matchedExisting < Math.min(3, eligibleEpisodes.length)) return null;
    return {
      sourceId,
      key: candidate.key,
      url: page.finalUrl.href,
      matchedEpisodes: matchedExisting,
      additions,
      title: titleHints[0] ?? candidate.key,
    };
  };

  for (const key of candidateKeys(anime, existingMappings)) {
    tried.add(key);
    try {
      const url = mappingUrl(sourceId, key);
      const page = await fetchHtml(url, sourceId);
      const found = await validate({ key, url }, page);
      if (found) return { found, errors };
    } catch {
      errors += 1;
    }
  }

  for (const query of animeTitles(anime, allowSeasonBase)
    .slice(0, 2)
    .map(cleanText)) {
    try {
      const search = await fetchHtml(searchUrl(sourceId, query), sourceId);
      if (!search) continue;
      for (const candidate of sourceLinks(search.html, sourceId)) {
        if (tried.has(candidate.key)) continue;
        tried.add(candidate.key);
        if (
          !candidate.title ||
          !matchesTitle(anime, [candidate.title], allowSeasonBase)
        )
          continue;
        const page = await fetchHtml(candidate.url, sourceId);
        const found = await validate(candidate, page);
        if (found) return { found, errors };
      }
    } catch {
      errors += 1;
    }
  }
  return { found: null, errors };
}

function stableShard(id) {
  return createHash('sha256').update(id).digest().readUInt32BE(0) % shardCount;
}

async function main() {
  let databaseUrl;
  let databaseIp;
  try {
    databaseUrl = new URL(
      readRemote('docker exec animesice-back-app-1 printenv DATABASE_URL'),
    );
    databaseIp = readRemote(
      'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" animesice-back-db-1',
    );
  } catch {
    throw new Error('não foi possível obter configuração da conexão via SSH');
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(databaseIp))
    throw new Error('IP privado do banco inválido');
  databaseUrl.hostname = '127.0.0.1';
  databaseUrl.port = String(PORT);
  const tunnel = startTunnel(databaseIp);
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
  pool.on('error', () => {});
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const state = apply
    ? readState()
    : {
        version: VERSION,
        done: [],
        retries: {},
        mapped: 0,
        episodeLinks: 0,
        errors: 0,
      };
  const assertTunnel = () => {
    if (tunnel.exitCode !== null) throw new Error('túnel SSH desconectado');
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
    if (!connected) throw new Error('banco não respondeu pelo túnel');
    const animes = await prisma.anime.findMany({
      select: {
        id: true,
        slug: true,
        title: true,
        japaneseTitle: true,
        alternativeTitles: true,
        audio: true,
        sourceMappings: {
          where: { sourceId: { in: PROVIDERS } },
          select: {
            sourceId: true,
            externalKey: true,
            externalUrl: true,
            audio: true,
          },
        },
        episodes: {
          select: {
            id: true,
            number: true,
            season: true,
            sources: { select: { sourceId: true } },
          },
        },
      },
      orderBy: { slug: 'asc' },
    });
    const eligible = animes.filter(
      (anime) =>
        anime.episodes.length > 0 &&
        (anime.sourceMappings.filter((mapping) => mapping.audio === anime.audio)
          .length <= 1 ||
          Boolean(state.retries[anime.id])),
    );
    const done = new Set(state.done);
    const partition = eligible.filter(
      (anime) => stableShard(anime.id) === shardIndex && !done.has(anime.id),
    );
    const candidates = partition.slice(0, limit);
    console.log(
      JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        eligible: eligible.length,
        shard: `${shardIndex}/${shardCount}`,
        remaining: partition.length,
        processing: candidates.length,
      }),
    );

    for (const anime of candidates) {
      if (stopped) break;
      try {
        assertTunnel();
        const mappings = anime.sourceMappings.filter(
          (mapping) => mapping.audio === anime.audio,
        );
        const seasonMatch = anime.slug.match(/-(\d{1,2})$/);
        const mappedBaseKey = seasonMatch
          ? anime.slug.replace(/-\d{1,2}$/, '')
          : '';
        const targetSeason =
          seasonMatch &&
          Number(seasonMatch[1]) > 1 &&
          mappings.some((mapping) => mapping.externalKey === mappedBaseKey)
            ? Number(seasonMatch[1])
            : 1;
        const discoveries = [];
        let providerErrors = 0;
        for (const sourceId of PROVIDERS) {
          if (mappings.some((mapping) => mapping.sourceId === sourceId))
            continue;
          const wrongAudioMapping = anime.sourceMappings.some(
            (mapping) =>
              mapping.sourceId === sourceId && mapping.audio !== anime.audio,
          );
          if (wrongAudioMapping) continue;
          const result = await discoverForProvider(
            anime,
            sourceId,
            mappings,
            targetSeason,
          );
          providerErrors += result.errors;
          if (result.found) discoveries.push(result.found);
        }
        for (const found of discoveries) {
          const plan = {
            slug: anime.slug,
            title: anime.title,
            audio: anime.audio,
            sourceId: found.sourceId,
            externalKey: found.key,
            catalogUrl: found.url,
            matchedEpisodes: found.matchedEpisodes,
            links: found.additions.length,
            titleEvidence: found.title,
          };
          const episodeLinks = showLinks
            ? found.additions.map((row) => {
                const episode = anime.episodes.find(
                  (item) => item.id === row.episodeId,
                );
                return {
                  season: episode?.season,
                  number: episode?.number,
                  pageUrl: row.pageUrl,
                  audio: row.audio,
                };
              })
            : undefined;
          console.log(
            JSON.stringify({
              ...plan,
              ...(showLinks ? { episodeLinks } : {}),
              applied: apply,
            }),
          );
          if (!apply) continue;
          assertTunnel();
          const result = await prisma.$transaction(async (tx) => {
            await tx.animeSource.create({
              data: {
                animeId: anime.id,
                sourceId: found.sourceId,
                externalUrl: found.url,
                externalKey: found.key,
                audio: anime.audio,
                confidence: 0.9,
                verifiedAt: new Date(),
              },
            });
            const write = found.additions.length
              ? await tx.episodeSource.createMany({
                  data: found.additions.map((row) => ({
                    ...row,
                    id: randomUUID(),
                  })),
                  skipDuplicates: true,
                })
              : { count: 0 };
            return write.count;
          });
          state.mapped += 1;
          state.episodeLinks += result;
        }
        if (providerErrors > 0) {
          state.retries[anime.id] = (state.retries[anime.id] ?? 0) + 1;
          if (state.retries[anime.id] >= 3) {
            done.add(anime.id);
            console.log(
              JSON.stringify({
                slug: anime.slug,
                retryExhausted: true,
                providerErrors,
              }),
            );
          } else {
            console.log(
              JSON.stringify({
                slug: anime.slug,
                retryScheduled: state.retries[anime.id],
                providerErrors,
              }),
            );
          }
        } else {
          delete state.retries[anime.id];
          done.add(anime.id);
        }
      } catch (error) {
        state.errors += 1;
        console.log(
          JSON.stringify({
            slug: anime.slug,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        if (tunnel.exitCode !== null) throw error;
        state.retries[anime.id] = (state.retries[anime.id] ?? 0) + 1;
        if (state.retries[anime.id] >= 3) done.add(anime.id);
      }
      if (done.has(anime.id) && !state.done.includes(anime.id))
        state.done.push(anime.id);
      if (apply) saveState(state);
    }
    const retryable = Object.values(state.retries).some(
      (attempts) => attempts < 3,
    );
    const complete =
      !stopped && candidates.length === partition.length && !retryable;
    console.log(
      JSON.stringify({
        complete,
        stopped,
        shard: `${shardIndex}/${shardCount}`,
        processed: candidates.length,
        ...state,
      }),
    );
    if (apply && retryable && !stopped) process.exitCode = 2;
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
