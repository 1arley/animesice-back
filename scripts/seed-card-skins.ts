#!/usr/bin/env ts-node
/** Cria uma skin MAL para cada carta ativa sem uma skin utilizável. */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Agent, fetch as undiciFetch } from 'undici';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const MAL = 'https://api.myanimelist.net/v2';
const RATE_LIMIT_MS = 1100;
const RETRIES = 3;
const BATCH_SIZE = 100;
const LOCK_ID = 731_942_016;
// shortcut: SSIM catches near-identical files, not substantial crops; upgrade if gallery duplicates are common.
const SAME_PHOTO_THRESHOLD = 0.05;
const REPORT_PATH =
  process.env.CARD_SKINS_REPORT ??
  join(
    homedir(),
    '.cache/animesice',
    `card-skin-seed-${new Date().toISOString().replace(/[:.]/g, '-')}.tsv`,
  );

interface CharacterPictures {
  pictures?: Array<{ medium?: string | null; large?: string | null } | null>;
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex < 0 ? Infinity : Number(args[limitIndex + 1]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const malAgent = new Agent({ connect: { family: 4 } });
let consecutiveApiFailures = 0;

function reportUnresolved(
  card: { id: string; malCharacterId: number; name: string },
  reason: string,
): void {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  const name = card.name.replace(/[\t\r\n]+/g, ' ');
  appendFileSync(
    REPORT_PATH,
    `${card.id}\t${card.malCharacterId}\t${reason}\t${name}\n`,
  );
}

function sameImage(a: string, b: string): boolean {
  const canonical = (value: string) => {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/r\/\d+x\d+(?=\/)/gi, '');
    url.pathname = url.pathname.replace(/\.(?:jpe?g|png|webp)$/i, '');
    return url.toString().toLowerCase();
  };
  try {
    return canonical(a) === canonical(b);
  } catch {
    return a === b;
  }
}

function photoDifference(metric: string): number {
  const value = Number(metric.match(/\(([-+\d.e]+)\)/i)?.[1]);
  if (!Number.isFinite(value)) throw new Error('SSIM inválido do ImageMagick');
  return value;
}

async function photoBytes(imageUrl: string): Promise<Buffer> {
  const url = new URL(imageUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.myanimelist.net') {
    throw new Error(`Host de imagem MAL inesperado: ${url.hostname}`);
  }
  const response = await undiciFetch(url, {
    dispatcher: malAgent,
    signal: AbortSignal.timeout(20_000),
  });
  if (
    !response.ok ||
    !response.headers.get('content-type')?.startsWith('image/')
  ) {
    throw new Error(`Imagem MAL indisponível: HTTP ${response.status}`);
  }
  const finalUrl = new URL(response.url);
  if (
    finalUrl.protocol !== 'https:' ||
    finalUrl.hostname !== 'cdn.myanimelist.net'
  ) {
    throw new Error(`Redirecionamento de imagem MAL inesperado: ${finalUrl.hostname}`);
  }
  if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) {
    throw new Error('Imagem MAL excede o limite de 16 MiB');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 16 * 1024 * 1024) {
    throw new Error('Imagem MAL excede o limite de 16 MiB');
  }
  return bytes;
}

function sameImageContent(originalPath: string, candidatePath: string): boolean {
  let metric: string;
  try {
    metric = execFileSync(
      'magick',
      [
        'compare',
        '-metric',
        'SSIM',
        '-resize',
        '225x350!',
        originalPath,
        candidatePath,
        'null:',
      ],
      { encoding: 'utf8' },
    );
  } catch (error) {
    const result = error as { status?: number; stderr?: string };
    if (result.status !== 1) throw error;
    metric = result.stderr ?? '';
  }
  return photoDifference(metric) <= SAME_PHOTO_THRESHOLD;
}

async function samePhoto(a: string, b: string): Promise<boolean> {
  const [original, candidate] = await Promise.all([photoBytes(a), photoBytes(b)]);
  const directory = mkdtempSync(join(tmpdir(), 'card-skin-'));
  const originalPath = join(directory, 'original');
  const candidatePath = join(directory, 'candidate');
  try {
    writeFileSync(originalPath, original);
    writeFileSync(candidatePath, candidate);
    return sameImageContent(originalPath, candidatePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  !sameImage(
    'https://cdn.myanimelist.net/images/characters/11/516853.jpg?signature=original',
    'https://cdn.myanimelist.net/images/characters/r/360x360/11/516853.jpg?signature=resized',
  )
) {
  throw new Error('Normalização de variantes redimensionadas do MAL falhou');
}
if (args.includes('--self-check')) {
  const directory = mkdtempSync(join(tmpdir(), 'card-skin-check-'));
  try {
    const original = join(directory, 'original.png');
    const reencoded = join(directory, 'reencoded.jpg');
    const different = join(directory, 'different.png');
    execFileSync('magick', ['-size', '225x350', 'gradient:white-black', original]);
    execFileSync('magick', [original, '-quality', '65', reencoded]);
    execFileSync('magick', ['-size', '225x350', 'xc:blue', different]);
    if (
      !sameImageContent(original, reencoded) ||
      sameImageContent(original, different)
    ) {
      throw new Error('Self-check da comparação SSIM falhou');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  console.log('[card-skins] normalização MAL e comparação SSIM OK');
  process.exit(0);
}

async function pictures(malId: number): Promise<CharacterPictures | null> {
  const clientId = process.env.MAL_CLIENT_ID;
  if (!clientId) throw new Error('MAL_CLIENT_ID ausente');

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    await sleep(RATE_LIMIT_MS);
    try {
      const response = await undiciFetch(
        `${MAL}/characters/${malId}?fields=pictures`,
        {
          dispatcher: malAgent,
          headers: { 'X-MAL-CLIENT-ID': clientId },
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (response.ok) {
        consecutiveApiFailures = 0;
        return (await response.json()) as CharacterPictures;
      }
      if (response.status === 404) {
        consecutiveApiFailures = 0;
        return null;
      }
      if (response.status === 400) {
        throw new Error('MAL rejeitou fields=pictures; seed interrompido');
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(`MAL recusou a chave (HTTP ${response.status})`);
      }
      const retryAfter = Number(response.headers.get('retry-after')) * 1000;
      if (
        response.status === 429 &&
        Number.isFinite(retryAfter) &&
        retryAfter > 0
      ) {
        await sleep(Math.min(retryAfter, 60_000));
      } else {
        console.warn(`[card-skins] MAL HTTP ${response.status} para ${malId}`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith('MAL recusou') ||
          error.message.startsWith('MAL rejeitou'))
      ) {
        throw error;
      }
      if (attempt === RETRIES) {
        console.warn(
          `[card-skins] MAL falhou para ${malId}: ${(error as Error).message}`,
        );
      }
    }
    await sleep(1000 * attempt);
  }
  consecutiveApiFailures += 1;
  if (consecutiveApiFailures >= 5) {
    throw new Error('MAL falhou em 5 cartas seguidas; worker interrompido');
  }
  throw new Error(`MAL indisponível após ${RETRIES} tentativas para ${malId}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
  if (!process.env.MAL_CLIENT_ID) throw new Error('MAL_CLIENT_ID ausente');
  if (limitIndex >= 0 && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit precisa ser um inteiro positivo');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const lock = await pool.connect();
  const stats = {
    planned: 0,
    created: 0,
    noAlternative: 0,
    malMissing: 0,
    failed: 0,
    processed: 0,
    skippedPreviously: 0,
  };
  const unresolvedFromPriorAttempt = new Set(
    existsSync(REPORT_PATH)
      ? readFileSync(REPORT_PATH, 'utf8')
          .split('\n')
          .map((line) => {
            const [id, , reason] = line.split('\t');
            return reason === 'mal_missing' || reason === 'no_alternative'
              ? id
              : undefined;
          })
          .filter((id): id is string => Boolean(id))
      : [],
  );
  let consecutiveWriteFailures = 0;

  try {
    const locked = (
      await lock.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [LOCK_ID],
      )
    ).rows[0]?.locked;
    if (!locked)
      throw new Error('Já existe um worker de skins conectado a este banco');

    const usableSkin = { active: true, blocked: false };
    const [total, covered, missingImage, synthetic] = await Promise.all([
      prisma.card.count(),
      prisma.card.count({ where: { skins: { some: usableSkin } } }),
      prisma.card.count({ where: { image: null } }),
      prisma.card.count({ where: { malCharacterId: { lte: 0 } } }),
    ]);
    const target = await prisma.card.count({
      where: {
        malCharacterId: { gt: 0 },
        image: { not: null },
        skins: { none: usableSkin },
      },
    });
    console.log(
      `[card-skins] mode=${apply ? 'apply' : 'dry-run'} total=${total} covered=${covered} target=${target} missingImage=${missingImage} synthetic=${synthetic}`,
    );

    let afterId: string | undefined;
    while (stats.processed < Math.min(target, limit)) {
      const cards = await prisma.card.findMany({
        where: {
          ...(afterId ? { id: { gt: afterId } } : {}),
          malCharacterId: { gt: 0 },
          image: { not: null },
          skins: { none: usableSkin },
        },
        select: { id: true, name: true, malCharacterId: true, image: true },
        orderBy: { id: 'asc' },
        take: Math.min(BATCH_SIZE, limit - stats.processed),
      });
      if (cards.length === 0) break;

      for (const card of cards) {
        afterId = card.id;
        stats.processed += 1;
        if (unresolvedFromPriorAttempt.has(card.id)) {
          stats.skippedPreviously += 1;
          continue;
        }
        try {
          const result = await pictures(card.malCharacterId);
          if (!result) {
            stats.malMissing += 1;
            reportUnresolved(card, 'mal_missing');
            continue;
          }
          const alternateImage = (result?.pictures ?? [])
            .map((picture) => picture?.large ?? picture?.medium)
            .find(
              (url): url is string =>
                Boolean(url?.startsWith('https://')) &&
                !sameImage(card.image!, url!),
            );
          if (!alternateImage) {
            stats.noAlternative += 1;
            reportUnresolved(card, 'no_alternative');
            continue;
          }
          const imageUrl = alternateImage;
          stats.planned += 1;
          if (!apply && stats.planned <= 5) {
            console.log(
              `[card-skins] amostra ${card.name} | padrão=${card.image} | skin=${imageUrl}`,
            );
          }
          if (apply) {
            try {
              const created = await prisma.$transaction(
                async (tx) => {
                  const existing = await tx.gachaSkin.findFirst({
                    where: { cardId: card.id, ...usableSkin },
                    select: { id: true },
                  });
                  if (existing) return false;
                  await tx.gachaSkin.create({
                    data: {
                      cardId: card.id,
                      name: `${card.name} — Skin MAL`,
                      imageUrl,
                      sourceUrl: `https://myanimelist.net/character/${card.malCharacterId}`,
                      rarity: 'COMMON',
                      active: true,
                      blocked: false,
                    },
                  });
                  return true;
                },
                { isolationLevel: 'Serializable' },
              );
              if (created) stats.created += 1;
              consecutiveWriteFailures = 0;
            } catch (error) {
              consecutiveWriteFailures += 1;
              stats.failed += 1;
              reportUnresolved(card, 'write_failed');
              if (consecutiveWriteFailures >= 3) {
                throw new Error(
                  'Banco falhou em 3 gravações seguidas; worker interrompido',
                );
              }
              console.warn(
                `[card-skins] gravação da carta ${card.id}: ${(error as Error).message}`,
              );
              continue;
            }
          }
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.startsWith('MAL recusou') ||
              error.message.startsWith('MAL rejeitou') ||
              error.message.startsWith('MAL falhou em 5 cartas') ||
              error.message.startsWith('Banco falhou em 3 gravações'))
          ) {
            throw error;
          }
          stats.failed += 1;
          reportUnresolved(card, 'failed');
          console.warn(
            `[card-skins] carta ${card.id}: ${(error as Error).message}`,
          );
        }
        if (stats.processed % BATCH_SIZE === 0) {
          console.log(`[card-skins] ${JSON.stringify(stats)}`);
        }
      }
    }
    console.log(`[card-skins] fim ${JSON.stringify(stats)}`);
  } finally {
    await lock
      .query('SELECT pg_advisory_unlock($1)', [LOCK_ID])
      .catch(() => {});
    lock.release();
    await prisma.$disconnect();
    await malAgent.close();
  }
}

void main().catch((error) => {
  const message = (error as Error).message;
  console.error('[card-skins] fatal:', message);
  process.exit(
    message.startsWith('MAL falhou em 5 cartas') ||
      message.startsWith('Banco falhou em 3 gravações') ||
      /PrismaClientInitializationError|Can't reach database server|ECONNRESET|Connection terminated/i.test(
        message,
      )
      ? 75
      : 1,
  );
});
