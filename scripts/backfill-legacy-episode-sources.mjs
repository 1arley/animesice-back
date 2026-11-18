#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const PROVIDERS = ['animesonline', 'meusanimes', 'animesorion'];
const HOSTS = {
  animesonline: ['animesonline.cloud', 'animesonlinecc.to'],
  meusanimes: ['meusanimes.blog'],
  animesorion: ['animesorion.cc', 'animexhd.xyz'],
};
const VERSION = 1;
const apply = process.argv.includes('--apply');
const shardArg = process.argv.indexOf('--shard');
const shard = shardArg < 0 ? '0/1' : process.argv[shardArg + 1];
const shardMatch = shard?.match(/^(\d+)\/(\d+)$/);
if (!shardMatch || Number(shardMatch[1]) >= Number(shardMatch[2]) || Number(shardMatch[2]) > 4) {
  throw new Error('--shard deve estar no formato N/TOTAL, com TOTAL até 4');
}
const shardIndex = Number(shardMatch[1]);
const shardCount = Number(shardMatch[2]);
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg < 0 ? Infinity : Number(process.argv[limitArg + 1]);
if ((!Number.isInteger(limit) && limit !== Infinity) || limit < 1) {
  throw new Error('--limit deve ser um inteiro positivo');
}
const checkpointPath = `/tmp/animesice-legacy-source-backfill-v${VERSION}-${shardIndex}-of-${shardCount}.json`;
const auditPath = `/tmp/animesice-legacy-source-backfill-v${VERSION}-${shardIndex}-of-${shardCount}.jsonl`;
const USER = 'iarley';
const SERVER = '65.52.197.161';
const PORT = 15530 + shardIndex;
const UA = 'AnimesIceLegacySourceBackfill/1.0';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopped = false;
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });

function readRemote(command) {
  return execFileSync('ssh', [
    '-i', `${homedir()}/.ssh/id_azure.pem`, '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=12', `${USER}@${SERVER}`, command,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function startTunnel(ip) {
  const child = spawn('ssh', [
    '-i', `${homedir()}/.ssh/id_azure.pem`, '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3', '-N', '-L', `127.0.0.1:${PORT}:${ip}:5432`,
    `${USER}@${SERVER}`,
  ], { stdio: 'ignore' });
  child.on('error', () => {});
  return child;
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    if (state.version === VERSION && Array.isArray(state.done)) return state;
  } catch {}
  return { version: VERSION, done: [], retries: {}, links: 0, errors: 0 };
}

function saveState(state) {
  const temp = `${checkpointPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state));
  renameSync(temp, checkpointPath);
}

function appendAudit(record) {
  const fd = openSync(auditPath, 'a', 0o600);
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function decodeHtml(value) {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ');
}

function cleanText(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function titleTokens(value) {
  return new Set(cleanText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((word) => (word.length > 1 || /^\d+$/.test(word)) && !new Set([
      'the', 'and', 'for', 'with', 'from', 'online', 'assistir', 'anime', 'animes',
      'dublado', 'dublada', 'dub', 'legendado', 'legendada', 'sub', 'subbed',
      'todos', 'episodios', 'episodio', 'temporada', 'season', 'seasons', 'ptbr',
      'portugues', 'watch', 'site', 'meus', 'orion',
    ]).has(word)));
}

function animeTitleHints(anime, allowSeasonBase) {
  const stripSeason = (title) => title
    .replace(/\b(?:season|temporada)\s*\d+\b/gi, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi, ' ')
    .replace(/\s+\d+\s*$/g, ' ')
    .replace(/\b(?:dublado|dublada|legendado|legendada)\b/gi, ' ');
  const titles = [anime.title, anime.japaneseTitle, ...anime.alternativeTitles].filter(Boolean);
  return [...new Set(titles.flatMap((title) => allowSeasonBase ? [title, stripSeason(title)] : [title]))];
}

function titleMatches(anime, hints, allowSeasonBase) {
  return hints.some((hint) => {
    const candidate = titleTokens(hint);
    if (!candidate.size) return false;
    return animeTitleHints(anime, allowSeasonBase).some((title) => {
      const expected = titleTokens(title);
      return expected.size === candidate.size && [...expected].every((word) => candidate.has(word));
    });
  });
}

function hasDubEvidence(anime, hints, mapping) {
  const text = `${hints.join(' ')} ${mapping.externalKey ?? ''} ${mapping.externalUrl}`
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dubbed = /\b(dublado|dublada|dub|portugues|pt\s*br|ptbr)\b/.test(text);
  return anime.audio === 'DUBLADO' ? dubbed : !dubbed;
}

assert.equal(catalogKeyFromUrl('https://animesonline.cloud/anime/bleach/', 'animesonline'), 'bleach');
assert.notEqual(catalogKeyFromUrl('https://animesonline.cloud/anime/bleach-dublado/', 'animesonline'), 'bleach');
assert.equal(hasDubEvidence({ audio: 'LEGENDADO' }, ['Bleach Dublado'], { externalKey: 'bleach-dublado', externalUrl: 'https://animesonline.cloud/anime/bleach-dublado' }), false);
assert.equal(hasDubEvidence({ audio: 'DUBLADO' }, ['Bleach Dublado'], { externalKey: 'bleach-dublado', externalUrl: 'https://animesonline.cloud/anime/bleach-dublado' }), true);

function extractTitleHints(html) {
  const hints = [];
  const patterns = [
    /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)/gi,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:title["']/gi,
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi,
    /<title\b[^>]*>([\s\S]*?)<\/title>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = cleanText(match[1]);
      if (value && !hints.includes(value)) hints.push(value);
    }
  }
  return hints;
}

function catalogKeyFromUrl(value, sourceId) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !HOSTS[sourceId]?.includes(url.hostname) || url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '');
    const key = sourceId === 'meusanimes' ? path.match(/^\/a\/([^/]+)$/i)?.[1]
      : sourceId === 'animesonline' ? path.match(/^\/anime\/([^/]+)$/i)?.[1]
        : path.match(/^\/animes\/([^/]+)$/i)?.[1];
    return key ? decodeURIComponent(key).toLowerCase() : null;
  } catch { return null; }
}

async function fetchHtml(url, sourceId, expectedKey) {
  const requested = new URL(url);
  if (requested.protocol !== 'https:' || !HOSTS[sourceId]?.includes(requested.hostname) || requested.username || requested.password) {
    throw new Error('catalog URL rejected');
  }
  await sleep(350);
  const response = await fetch(requested, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow', signal: AbortSignal.timeout(15_000),
  });
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:' || !HOSTS[sourceId].includes(finalUrl.hostname) || finalUrl.username || finalUrl.password) {
    throw new Error('redirect host rejected');
  }
  if (catalogKeyFromUrl(finalUrl, sourceId) !== expectedKey.toLowerCase()) throw new Error('redirect catalog identity mismatch');
  if (response.status === 429 || response.status >= 500) throw new Error(`provider HTTP ${response.status}`);
  if (!response.ok) return null;
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 3_000_000) throw new Error('catalog response too large');
  const html = await response.text();
  if (html.length > 3_000_000) throw new Error('catalog response too large');
  if (/cf-chl-|just a moment|checking your browser/i.test(html) && html.length < 30_000) {
    throw new Error('provider challenge page');
  }
  return html;
}

function parseCatalogEntries(html, sourceId, sourceKey) {
  const entries = new Map();
  const markers = [...html.matchAll(/class=["'][^"']*numerando[^"']*["'][^>]*>\s*(\d+)\s*-\s*(\d+)\s*<\/[^>]+>/gi)];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[index + 1]?.index ?? Math.min(html.length, start + 1800);
    const href = html.slice(start, end).match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const url = new URL(decodeHtml(href));
      if (!HOSTS[sourceId].includes(url.hostname)) continue;
      const season = Number(marker[1]), episode = Number(marker[2]);
      if (season > 0 && episode > 0) entries.set(`${season}:${episode}`, { season, episode, url: url.href });
    } catch {}
  }
  if (markers.length === 0 && sourceId === 'meusanimes') {
    const re = /https:\/\/meusanimes\.blog\/e\/([^\s"'<>]+?)-episodio-0*(\d+)\/?/gi;
    for (const match of html.matchAll(re)) {
      const episode = Number(match[2]);
      const pageSlug = match[1];
      const sibling = pageSlug.match(new RegExp(`^${sourceKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i'));
      const season = sibling ? Number(sibling[1]) : 1;
      if (episode > 0) entries.set(`${season}:${episode}`, { season, episode, url: match[0] });
    }
  }
  if (sourceId === 'animesonline') {
    for (const match of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
      try {
        const url = new URL(decodeHtml(match[1]));
        if (!HOSTS[sourceId].includes(url.hostname)) continue;
        const parsed = url.pathname.match(/^\/episodio\/(.+?)-episodio-0*(\d+)\/?$/i);
        if (!parsed) continue;
        const sibling = parsed[1].match(new RegExp(`^${sourceKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i'));
        const season = sibling ? Number(sibling[1]) : 1;
        const episode = Number(parsed[2]);
        if (episode > 0) entries.set(`${season}:${episode}`, { season, episode, url: url.href });
      } catch {}
    }
  }
  return [...entries.values()];
}

function normalizedPagePath(value, sourceId) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !HOSTS[sourceId].includes(url.hostname) || url.username || url.password) return null;
    return url.pathname.replace(/\/+$/, '').toLowerCase();
  } catch { return null; }
}

function pageEpisode(value, sourceId, sourceKey) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !HOSTS[sourceId].includes(url.hostname) || url.username || url.password) return null;
    if (sourceId === 'animesorion') {
      const match = url.pathname.match(/^\/episodios\/(.+?)-(\d+)x(\d+)\/?$/i);
      return match ? { season: Number(match[2]), episode: Number(match[3]) } : null;
    }
    if (sourceId === 'animesonline') {
      const match = url.pathname.match(/^\/episodio\/(.+?)-episodio-0*(\d+)\/?$/i);
      if (!match) return null;
      const sibling = match[1].match(new RegExp(`^${sourceKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i'));
      return { season: sibling ? Number(sibling[1]) : 1, episode: Number(match[2]) };
    }
    const match = url.pathname.match(/^\/e\/(.+?)-episodio-0*(\d+)\/?$/i);
    if (!match) return null;
    const sibling = match[1].match(new RegExp(`^${sourceKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i'));
    return { season: sibling ? Number(sibling[1]) : 1, episode: Number(match[2]) };
  } catch { return null; }
}

function stableShard(id) {
  return createHash('sha256').update(id).digest().readUInt32BE(0) % shardCount;
}

async function planLegacyForMapping(anime, mapping) {
  const legacyEpisodes = anime.episodes.filter((episode) => episode.sourceId === mapping.sourceId &&
    episode.embedUrl && !episode.sources.some((source) => source.sourceId === mapping.sourceId));
  if (!legacyEpisodes.length || mapping.audio !== anime.audio || !mapping.externalKey) return { rows: [], errors: 0 };
  const catalogUrl = new URL(mapping.externalUrl);
  if (catalogUrl.protocol !== 'https:' || !HOSTS[mapping.sourceId]?.includes(catalogUrl.hostname)) return { rows: [], errors: 0 };
  const suffix = anime.slug.match(/-(\d{1,2})$/);
  const baseSlug = suffix ? anime.slug.replace(/-\d{1,2}$/, '') : '';
  const season = suffix && Number(suffix[1]) > 1 && mapping.externalKey === baseSlug ? Number(suffix[1]) : 1;
  const allowSeasonBase = season > 1;
  try {
    const html = await fetchHtml(mapping.externalUrl, mapping.sourceId, mapping.externalKey);
    if (!html) return { rows: [], errors: 0 };
    const titles = extractTitleHints(html);
    if (!titleMatches(anime, titles, allowSeasonBase) || !hasDubEvidence(anime, titles, mapping)) return { rows: [], errors: 0 };
    const entries = parseCatalogEntries(html, mapping.sourceId, mapping.externalKey)
      .filter((entry) => entry.season === season);
    const exactSeasonEpisodes = anime.episodes.filter((episode) => episode.season === season);
    const localSeasonEpisodes = exactSeasonEpisodes.length || season === 1
      ? exactSeasonEpisodes
      : anime.episodes.filter((episode) => episode.season === 1);
    if (entries.filter((entry) => localSeasonEpisodes.some((episode) => episode.number === entry.episode)).length < Math.min(3, localSeasonEpisodes.length)) {
      return { rows: [], errors: 0 };
    }
    const entryByPath = new Map(entries.map((entry) => [normalizedPagePath(entry.url, mapping.sourceId), entry]));
    const rows = [];
    for (const episode of legacyEpisodes) {
      const legacyPath = normalizedPagePath(episode.embedUrl, mapping.sourceId);
      const entry = legacyPath && entryByPath.get(legacyPath);
      if (!entry || episode.number !== entry.episode) continue;
      const pageNumbers = pageEpisode(episode.embedUrl, mapping.sourceId, mapping.externalKey);
      if (!pageNumbers || pageNumbers.episode !== episode.number || pageNumbers.season !== entry.season) continue;
      const exact = episode.season === entry.season;
      const splitSibling = season > 1 && episode.season === 1 && entry.season === season;
      if (!exact && !splitSibling) continue;
      rows.push({ episodeId: episode.id, sourceId: mapping.sourceId, pageUrl: episode.embedUrl, audio: anime.audio });
    }
    return { rows, errors: 0 };
  } catch {
    return { rows: [], errors: 1 };
  }
}

async function main() {
  let databaseUrl;
  let databaseIp;
  try {
    databaseUrl = new URL(readRemote('docker exec animesice-back-app-1 printenv DATABASE_URL'));
    databaseIp = readRemote('docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" animesice-back-db-1');
  } catch {
    throw new Error('não foi possível obter a configuração do banco via SSH');
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(databaseIp)) throw new Error('IP privado do banco inválido');
  databaseUrl.hostname = '127.0.0.1';
  databaseUrl.port = String(PORT);
  const tunnel = startTunnel(databaseIp);
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
  pool.on('error', () => {});
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const state = apply ? readState() : { version: VERSION, done: [], retries: {}, links: 0, errors: 0 };
  const assertTunnel = () => { if (tunnel.exitCode !== null) throw new Error('túnel SSH desconectado'); };
  try {
    let connected = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { await prisma.$queryRaw`SELECT 1`; connected = true; break; } catch { await sleep(500); }
    }
    if (!connected) throw new Error('banco não respondeu pelo túnel');
    const animes = await prisma.anime.findMany({
      where: {
        episodes: { some: { sourceId: { in: PROVIDERS }, embedUrl: { not: null } } },
        sourceMappings: { some: { sourceId: { in: PROVIDERS } } },
      },
      select: {
        id: true, slug: true, title: true, japaneseTitle: true, alternativeTitles: true, audio: true,
        sourceMappings: { where: { sourceId: { in: PROVIDERS } }, select: { sourceId: true, externalKey: true, externalUrl: true, audio: true } },
        episodes: { select: { id: true, number: true, season: true, sourceId: true, embedUrl: true, sources: { select: { sourceId: true } } } },
      },
      orderBy: { slug: 'asc' },
    });
    const eligible = animes.filter((anime) => anime.episodes.some((episode) =>
      episode.embedUrl && PROVIDERS.includes(episode.sourceId) && !episode.sources.some((source) => source.sourceId === episode.sourceId) &&
      anime.sourceMappings.some((mapping) => mapping.sourceId === episode.sourceId && mapping.audio === anime.audio)));
    const done = new Set(state.done);
    const partition = eligible.filter((anime) => stableShard(anime.id) === shardIndex && !done.has(anime.id));
    const candidates = partition.slice(0, limit);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', eligible: eligible.length, shard: `${shardIndex}/${shardCount}`, remaining: partition.length, processing: candidates.length }));

    for (const anime of candidates) {
      if (stopped) break;
      try {
        assertTunnel();
        const plans = [];
        let failures = 0;
        let legacyCandidates = 0;
        const mappings = anime.sourceMappings.filter((mapping) => mapping.audio === anime.audio &&
          anime.episodes.some((episode) => episode.sourceId === mapping.sourceId && episode.embedUrl && !episode.sources.some((source) => source.sourceId === mapping.sourceId)));
        for (const mapping of mappings) {
          const result = await planLegacyForMapping(anime, mapping);
          failures += result.errors;
          legacyCandidates += anime.episodes.filter((episode) => episode.sourceId === mapping.sourceId && episode.embedUrl &&
            !episode.sources.some((source) => source.sourceId === mapping.sourceId)).length;
          if (result.rows.length) plans.push({ sourceId: mapping.sourceId, rows: result.rows });
        }
        let animeLinksWritten = 0;
        for (const plan of plans) {
          console.log(JSON.stringify({ slug: anime.slug, sourceId: plan.sourceId, candidates: plan.rows.length, applied: apply }));
          if (!apply) continue;
          assertTunnel();
          const created = plan.rows.map((row) => ({ ...row, id: randomUUID() }));
          appendAudit({ event: 'intent', animeId: anime.id, slug: anime.slug, sourceId: plan.sourceId, episodeSources: created.map(({ id, episodeId }) => ({ id, episodeId })) });
          const inserted = await prisma.$transaction(async (tx) => {
            await tx.episodeSource.createMany({ data: created, skipDuplicates: true });
            return tx.episodeSource.findMany({ where: { id: { in: created.map((row) => row.id) } }, select: { id: true, episodeId: true } });
          });
          state.links += inserted.length;
          animeLinksWritten += inserted.length;
          appendAudit({ event: 'committed', animeId: anime.id, sourceId: plan.sourceId, episodeSources: inserted });
        }
        console.log(JSON.stringify({ slug: anime.slug, legacyCandidates, legacyLinksWritten: animeLinksWritten }));
        if (failures) {
          state.retries[anime.id] = (state.retries[anime.id] ?? 0) + 1;
          if (state.retries[anime.id] >= 3) {
            done.add(anime.id);
            console.log(JSON.stringify({ slug: anime.slug, retryExhausted: true, failures }));
          }
        } else {
          delete state.retries[anime.id];
          done.add(anime.id);
        }
      } catch (error) {
        state.errors += 1;
        console.log(JSON.stringify({ slug: anime.slug, error: error instanceof Error ? error.message : String(error) }));
        if (tunnel.exitCode !== null) throw error;
        state.retries[anime.id] = (state.retries[anime.id] ?? 0) + 1;
        if (state.retries[anime.id] >= 3) done.add(anime.id);
      }
      if (done.has(anime.id) && !state.done.includes(anime.id)) state.done.push(anime.id);
      if (apply) saveState(state);
    }
    const retryable = Object.values(state.retries).some((attempts) => attempts < 3);
    const complete = !stopped && candidates.length === partition.length && !retryable;
    console.log(JSON.stringify({ complete, stopped, shard: `${shardIndex}/${shardCount}`, processed: candidates.length, ...state }));
    if (apply && retryable && !stopped) process.exitCode = 2;
  } finally {
    try { await prisma.$disconnect(); } finally { try { await pool.end(); } finally { tunnel.kill('SIGTERM'); } }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
