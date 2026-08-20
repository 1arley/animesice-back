#!/usr/bin/env ts-node
/**
 * fuzzy-dry-run.ts — compara a busca ATUAL (contains/ILIKE) com a busca FUZZY
 * (pg_trgm) em dados reais, SEM alterar nada no banco.
 *
 * Uso:
 *   npm run fuzzy:dry -- "kaguya"        # threshold padrão 0.25
 *   npm run fuzzy:dry -- "kaichou" 0.2
 * Env: DATABASE_URL
 *
 * O que ele mostra:
 *   - se a extensão pg_trgm está disponível no banco (e os índices existem);
 *   - o que a busca antiga acha (contains) e quantos resultados;
 *   - o que a busca nova (fuzzy) acha, com o score de similaridade;
 *   - os títulos que SÓ a fuzzy encontra (o ganho real de recall — typos,
 *     ordem de palavras, romaji/japonês).
 *
 * Serve para calibrar o SEARCH_FUZZY_THRESHOLD com dados reais antes de
 * subir a migration para produção.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

async function main(): Promise<void> {
  const query = process.argv[2];
  const threshold = Number(process.argv[3] ?? 0.35);

  if (!query) {
    console.error(
      'Uso: npm run fuzzy:dry -- "query" [threshold]\nEnv: DATABASE_URL',
    );
    process.exit(1);
  }
  if (query.trim().length < 3) {
    console.error('Query muito curta (<3 chars) — a fuzzy nem é acionada.');
    process.exit(1);
  }

  const prisma = createPrismaClient();
  await prisma.$connect();
  console.log(`\n=== Busca: "${query}" | threshold=${threshold} ===\n`);

  // 1. Estado da extensão/índices.
  try {
    const ext = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Anime' AND indexname LIKE '%trgm%'`;
    console.log(
      `pg_trgm: ${ext.length > 0 ? '✅ disponível' : '❌ ausente — a fuzzy não funciona e a busca degrada p/ contains'}`,
    );
    console.log(
      `índices GIN: ${idx.length > 0 ? idx.map((i) => i.indexname).join(', ') : '❌ nenhum'}`,
    );
  } catch (err) {
    console.error(
      'pg_trgm ausente (ou sem permissão) — busca fuzzy indisponível:',
      err instanceof Error ? err.message : String(err),
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // 2. Busca antiga (contains).
  const oldRes = await prisma.anime.findMany({
    where: {
      published: true,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { japaneseTitle: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 20,
    select: { slug: true, title: true },
  });

  // 3. Busca fuzzy (pg_trgm word_similarity, tokenizada) com score.
  //    Espelha a SQL do AnimeService.fuzzyRankedIds.
  const fuzzyRows = await prisma.$queryRaw<
    Array<{ id: string; slug: string; title: string; score: number }>
  >`
    SELECT t.id, a.slug, a.title, ROUND(SUM(t.ws)::numeric, 3) AS score
    FROM (
      SELECT a.id, GREATEST(
          word_similarity(w, LOWER(a.title)),
          COALESCE(word_similarity(w, LOWER(a."japaneseTitle")), 0),
          COALESCE(word_similarity(w, LOWER(array_to_string(a."alternativeTitles", ' '))), 0)
        ) AS ws
      FROM "Anime" a
      CROSS JOIN LATERAL unnest(string_to_array(LOWER(${query}), ' ')) AS w
      WHERE a.published = true
    ) t
    JOIN "Anime" a ON a.id = t.id
    GROUP BY t.id, a.slug, a.title
    HAVING MAX(t.ws) > ${threshold}
    ORDER BY SUM(t.ws) DESC
    LIMIT 20`;

  console.log(`--- Busca ANTIGA (contains) — ${oldRes.length} resultados ---`);
  for (const a of oldRes) console.log(`  ${a.slug}  ${a.title}`);

  console.log(`\n--- Busca NOVA (fuzzy) — ${fuzzyRows.length} resultados ---`);
  for (const a of fuzzyRows) console.log(`  [${a.score}] ${a.slug}  ${a.title}`);

  // 4. O ganho de recall (o que só a fuzzy encontra).
  const oldSlugs = new Set(oldRes.map((a) => a.slug));
  const onlyFuzzy = fuzzyRows.filter((a) => !oldSlugs.has(a.slug));
  if (onlyFuzzy.length > 0) {
    console.log('\n--- Só a fuzzy encontra (typos/romaji/ordem) ---');
    for (const a of onlyFuzzy) console.log(`  [${a.score}] ${a.slug}  ${a.title}`);
  } else {
    console.log('\n(Sem resultados extras — contains e fuzzy concordam)');
  }

  const missed = oldRes.filter((a) => !fuzzyRows.some((f) => f.slug === a.slug));
  if (missed.length > 0) {
    console.log('\n--- Só a antiga encontra (abaixo do threshold) ---');
    for (const a of missed) console.log(`  ${a.slug}  ${a.title}`);
  }

  console.log(
    `\nDica: suba/diminua o threshold p/ calibrar (mais alto = menos ruído). ` +
      `O padrão do serviço é SEARCH_FUZZY_THRESHOLD=${threshold}.`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
