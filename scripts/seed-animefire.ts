#!/usr/bin/env ts-node
/**
 * seed-animefire.ts — Scraper do catálogo do animefire.io + enriquecimento AniList.
 *
 * Fluxo:
 *   1. https://animefire.io/sitemap.xml -> lista todos os URLs de epsódios
 *      ex: https://animefire.io/animes/<slug>/<n>
 *   2. Agrupa por slug -> [{ slug, episodeCount, episodeUrls }]
 *   3. Para cada anime único:
 *      a. GET https://animefire.io/animes/<slug> -> HTML
 *         - extrai título, capa, sinopse da <div class="div_botPages_bg">
 *         - extrai todos os episode links: a.lEp.epT... (n+URL)
 *      b. Busca título no AniList GraphQL -> cover/synopsis/genres/banner/rating/isAdult
 *      c. Cria (upsert) Anime + Genres no Prisma
 *      d. Cria (upsert) Episodes com embedUrl = animefire URL (p/ lazy extract no runtime)
 *   4. Loga progresso, suporta --limit N, --resume, --skip-anilist.
 *
 * Uso:
 *   ts-node scripts/seed-animefire.ts [--limit N] [--skip-anilist] [--offset N]
 *
 * Env: DATABASE_URL, API_PREFIX (opcional).
 */

import 'dotenv/config';
import { PrismaClient, AudioType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const ANIMEFIRE_BASE = 'https://animefire.io';
const SITEMAP_URL = 'https://animefire.io/sitemap.xml';
const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AnimefireEpisode {
  slug: string;
  number: number;
  url: string;
}

interface AnimefireCatalogEntry {
  slug: string;
  episodeUrls: { number: number; url: string }[];
}

// --- Prisma ----------------------------------------------------------------

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

// --- Helpers ----------------------------------------------------------------

function slugify(input: string): string {
  return (
    input
      .toString()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/[''`]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 80) || 'anime'
  );
}

// --- Sitemap ----------------------------------------------------------------

async function fetchSitemap(): Promise<string[]> {
  console.log('[SITEMAP] Baixando sitemap...');
  const res = await fetch(SITEMAP_URL, {
    headers: { 'user-agent': UA },
  });
  if (!res.ok) {
    throw new Error(`sitemap.xml retornou ${res.status}`);
  }
  const xml = await res.text();
  const urls: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const url = m[1]!.trim();
    if (/\/animes\/[^/]+\/\d+/.test(url)) {
      urls.push(url);
    }
  }
  console.log(`[SITEMAP] ${urls.length} URLs de epsódios encontrados`);
  return urls;
}

function groupBySlug(urls: string[]): AnimefireCatalogEntry[] {
  const map = new Map<string, AnimefireCatalogEntry>();
  for (const url of urls) {
    const m = url.match(/\/animes\/([^/]+)\/(\d+)/);
    if (!m) continue;
    const slug = m[1]!;
    const number = parseInt(m[2]!, 10);
    const entry = map.get(slug) ?? { slug, episodeUrls: [] };
    entry.episodeUrls.push({ number, url });
    map.set(slug, entry);
  }
  for (const entry of map.values()) {
    entry.episodeUrls.sort((a, b) => a.number - b.number);
  }
  return [...map.values()];
}

// --- Animefire page parser --------------------------------------------------

interface AnimefirePageInfo {
  title: string | null;
  coverImage: string | null;
  synopsis: string | null;
}

async function fetchAnimefirePageInfo(
  slug: string,
): Promise<AnimefirePageInfo> {
  try {
    const res = await fetch(`${ANIMEFIRE_BASE}/animes/${slug}`, {
      headers: {
        'user-agent': UA,
        'accept-language': 'pt-BR,pt;q=0.9',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) return { title: null, coverImage: null, synopsis: null };
    const html = await res.text();

    let title: string | null = null;
    let coverImage: string | null = null;
    let synopsis: string | null = null;

    const titleM = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (titleM) title = titleM[1]!.trim();

    const coverM = html.match(/\/div_botPages_bg[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i)
      || html.match(/<img[^>]+class=["'][^"']*(?:anime|cover|poster|capa)[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (coverM) {
      coverImage = coverM[1]!.startsWith('http')
        ? coverM[1]!
        : `${ANIMEFIRE_BASE}${coverM[1]!}`;
    }

    const synM = html.match(/<div[^>]*id=["']synopsis["'][^>]*>([\s\S]*?)<\/div>/i)
      || html.match(/<p[^>]*class=["'][^"']*syn[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    if (synM) {
      synopsis = synM[1]!.replace(/[<>]/g, '').trim().slice(0, 2000);
    }

    return { title, coverImage, synopsis };
  } catch {
    return { title: null, coverImage: null, synopsis: null };
  }
}

// --- AniList ----------------------------------------------------------------

interface AniListResult {
  id: number;
  title: string;
  romaji?: string | null;
  english?: string | null;
  coverImage?: string | null;
  bannerImage?: string | null;
  description?: string | null;
  averageScore?: number | null;
  isAdult?: boolean | null;
  genres?: string[];
}

async function searchAniList(query: string): Promise<AniListResult | null> {
  const gql = `
    query ($search: String, $perPage: Int) {
      Page(perPage: $perPage) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title { romaji english native }
          description
          coverImage { large extraLarge }
          bannerImage
          averageScore
          isAdult
          genres
        }
      }
    }`;

  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: gql, variables: { search: query, perPage: 1 } }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const media = json?.data?.Page?.media?.[0];
    if (!media) return null;

    return {
      id: media.id,
      title: media.title?.romaji || media.title?.english || media.title?.native || query,
      romaji: media.title?.romaji,
      english: media.title?.english,
      coverImage: media.coverImage?.large || media.coverImage?.extraLarge,
      bannerImage: media.bannerImage ?? null,
      description: media.description?.replace(/<[^>]+>/g, '').trim().slice(0, 2000) || null,
      averageScore: media.averageScore,
      isAdult: media.isAdult,
      genres: media.genres ?? [],
    };
  } catch {
    return null;
  }
}

// --- Main -------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  console.log(`[SEED] Iniciando seed do catálogo animefire (limit=${args.limit}, skipAniList=${args.skipAniList}, offset=${args.offset})`);

  const epsodeUrls = await fetchSitemap();
  const catalog = groupBySlug(epsodeUrls);
  console.log(`[SEED] ${catalog.length} animes únicos no catálogo`);

  const slice = catalog.slice(args.offset, args.offset + args.limit);
  console.log(`[SEED] Processando ${slice.length} animes (offset=${args.offset})`);

  const genreCache = new Map<string, string>();
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of slice) {
    try {
      const dbSlug = entry.slug;

      const existing = await prisma.anime.findUnique({ where: { slug: dbSlug }, select: { id: true } });
      if (existing) {
        console.log(`  ⏭  ${dbSlug} — já existe, pulando`);
        skipped++;
        continue;
      }

      let pageInfo: AnimefirePageInfo = { title: null, coverImage: null, synopsis: null };
      let anilist: AniListResult | null = null;

      if (!args.skipAniList) {
        const searchQuery = dbSlug.replace(/-/g, ' ');
        anilist = await searchAniList(searchQuery);
        await sleep(700);
      }

      if (!anilist) {
        pageInfo = await fetchAnimefirePageInfo(entry.slug);
        await sleep(400);
      }

      const title =
        anilist?.title ||
        pageInfo.title ||
        dbSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      const coverImage = anilist?.coverImage || pageInfo.coverImage || null;
      const bannerImage = anilist?.bannerImage || null;
      const synopsis = anilist?.description || pageInfo.synopsis || null;
      const rating = anilist?.averageScore ? anilist.averageScore / 10 : 0;
      const ageRating = anilist?.isAdult ? 'A18' : 'A14';

      const genreIds: string[] = [];
      if (!args.skipAniList && anilist?.genres) {
        for (const g of anilist.genres) {
          const gSlug = slugify(g);
          if (!gSlug) continue;
          const cached = genreCache.get(gSlug);
          if (cached) {
            genreIds.push(cached);
            continue;
          }
          try {
            const record = await prisma.genre.upsert({
              where: { slug: gSlug },
              update: { name: g },
              create: { slug: gSlug, name: g },
            });
            genreCache.set(gSlug, record.id);
            genreIds.push(record.id);
          } catch {}
        }
      }

      const animeRecord = await prisma.anime.create({
        data: {
          slug: dbSlug,
          title,
          synopsis,
          coverImage,
          bannerImage,
          rating,
          status: 'LANCAMENTO',
          audio: AudioType.LEGENDADO,
          ageRating,
          genres: genreIds.length ? { connect: genreIds.map((id) => ({ id })) } : undefined,
        },
      });

      for (const ep of entry.episodeUrls) {
        try {
          await prisma.episode.upsert({
            where: { animeId_number: { animeId: animeRecord.id, number: ep.number } },
            update: { embedUrl: ep.url },
            create: {
              number: ep.number,
              title: `Episódio ${ep.number}`,
              thumbnailUrl: coverImage,
              videoUrl: null,
              embedUrl: ep.url,
              animeId: animeRecord.id,
            },
          });
        } catch {}
      }

      console.log(`  ✓ ${title} (${dbSlug}) — ${entry.episodeUrls.length} eps${anilist ? ' + AniList' : ''}`);
      created++;
    } catch (err) {
      console.error(`  ✗ ${entry.slug} — ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
    await sleep(150);
  }

  console.log(`\n[SEED] Concluído: ${created} criados, ${skipped} pulados, ${failed} falhas`);
  await prisma.$disconnect();
}

function parseArgs() {
  const args = { limit: Infinity, skipAniList: false, offset: 0 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' || argv[i] === '-l') {
      args.limit = parseInt(argv[++i] || '', 10) || Infinity;
    } else if (argv[i] === '--skip-anilist') {
      args.skipAniList = true;
    } else if (argv[i] === '--offset' || argv[i] === '-o') {
      args.offset = parseInt(argv[++i] || '', 10) || 0;
    }
  }
  return args;
}

main()
  .catch((e) => {
    console.error('[SEED] Falhou:', e);
    process.exit(1);
  });
