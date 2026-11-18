#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
try {
  require('dotenv/config');
} catch {
  // Em produção, DATABASE_URL é injetada pelo ambiente.
}
const { AudioType, PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');

function displayTitle(title) {
  const base = title
    .replace(/[\s(-]*todos os episodios[\s)-]*$/i, '')
    .replace(/[\s(-]*pt[- ]br[\s)-]*$/i, '')
    .replace(/(^|\s)dublado(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base} Dublado`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const anime = await prisma.anime.findMany({
      where: {
        OR: [
          { audio: AudioType.DUBLADO },
          { slug: { contains: 'dublado', mode: 'insensitive' } },
        ],
      },
      select: { id: true, slug: true, title: true, audio: true },
      orderBy: { slug: 'asc' },
    });
    const fixes = anime.flatMap((row) => {
      const isDubbed =
        row.audio === AudioType.DUBLADO || /(^|-)dublado($|-)/i.test(row.slug);
      if (!isDubbed) return [];
      const title = displayTitle(row.title);
      return row.audio !== AudioType.DUBLADO || title !== row.title
        ? [{ id: row.id, slug: row.slug, title }]
        : [];
    });
    console.log(
      JSON.stringify({
        matched: anime.length,
        fixes: fixes.length,
        apply: APPLY,
        sample: fixes.slice(0, 20).map(({ slug, title }) => ({ slug, title })),
      }),
    );
    if (!APPLY) return;

    for (let offset = 0; offset < fixes.length; offset += 100) {
      await prisma.$transaction(
        fixes.slice(offset, offset + 100).map((fix) =>
          prisma.anime.update({
            where: { id: fix.id },
            data: { title: fix.title, audio: AudioType.DUBLADO },
          }),
        ),
      );
    }
    console.log(JSON.stringify({ repaired: fixes.length }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
