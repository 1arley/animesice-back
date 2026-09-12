#!/usr/bin/env ts-node
/**
 * backfill-gacha-values.ts — recalcula UserCard.value com a curva atual de
 * cardValue (base por raridade × condition × foil + bônus proporcional de
 * edição). value é derivativo puro, então o backfill é exato e idempotente:
 * só reescreve linhas cujo valor diverge do calculado.
 *
 * Uso: ts-node scripts/backfill-gacha-values.ts [--dry] [--limit N]
 * Env: DATABASE_URL
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  cardValue,
  GACHA_FOILS,
  GACHA_TIERS,
  type GachaFoil,
  type GachaTier,
} from '../src/gacha/gacha.constants';

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || '' });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

async function main() {
  const args = parseArgs();
  const cards = await prisma.userCard.findMany({
    select: {
      id: true,
      userId: true,
      condition: true,
      foil: true,
      edition: true,
      value: true,
      card: { select: { name: true, rarity: true } },
    },
  });
  console.log(`[BACKFILL] ${cards.length} cartas na coleção.`);

  const before = new Map<string, number>();
  const after = new Map<string, number>();
  for (const c of cards) {
    before.set(c.userId, (before.get(c.userId) ?? 0) + c.value);
    after.set(c.userId, (after.get(c.userId) ?? 0) + c.value);
  }

  const invalid: string[] = [];
  const changed: { id: string; card: string; from: number; to: number }[] = [];
  for (const c of cards) {
    if (
      !GACHA_TIERS.includes(c.card.rarity as GachaTier) ||
      !GACHA_FOILS.includes(c.foil as GachaFoil)
    ) {
      invalid.push(`${c.id} (${c.card.rarity}/${c.foil})`);
      continue;
    }
    const expected = cardValue(
      c.card.rarity as GachaTier,
      c.condition,
      c.foil as GachaFoil,
      c.edition,
    );
    if (expected === c.value) continue;
    if (changed.length < args.limit) {
      changed.push({
        id: c.id,
        card: c.card.name,
        from: c.value,
        to: expected,
      });
    }
    after.set(c.userId, (after.get(c.userId) ?? 0) - c.value + expected);
  }

  for (const c of changed) {
    console.log(`  ${args.dry ? '[dry] ' : ''}${c.card}: ${c.from} -> ${c.to}`);
  }
  console.log(`\n[BACKFILL] por usuário (antes -> depois):`);
  for (const [userId, oldSum] of before) {
    const newSum = after.get(userId) ?? oldSum;
    if (newSum !== oldSum) {
      console.log(`  ${userId}: ${oldSum} -> ${newSum}`);
    }
  }

  if (!args.dry) {
    for (const c of changed) {
      await prisma.userCard.update({
        where: { id: c.id },
        data: { value: c.to },
      });
    }
  }
  invalid.forEach((i) => console.error(`  ! raridade/foil inválidos: ${i}`));
  console.log(
    `\n[BACKFILL] ${changed.length} cartas ${args.dry ? 'mudariam' : 'reatualizadas'}, ${invalid.length} puladas.`,
  );
  await prisma.$disconnect();
}

function parseArgs() {
  const args = { limit: 999999, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' || argv[i] === '-l')
      args.limit = parseInt(argv[++i] || '', 10) || 999999;
    else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

main().catch((e) => {
  console.error('[BACKFILL] Falhou:', e);
  process.exit(1);
});
