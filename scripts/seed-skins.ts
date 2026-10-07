#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const skins = [
  // COMMON (BASIC) - 10
  { name: 'Skin Comum 1', imageUrl: 'https://cdn.animesice.io/skins/common1.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 2', imageUrl: 'https://cdn.animesice.io/skins/common2.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 3', imageUrl: 'https://cdn.animesice.io/skins/common3.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 4', imageUrl: 'https://cdn.animesice.io/skins/common4.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 5', imageUrl: 'https://cdn.animesice.io/skins/common5.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 6', imageUrl: 'https://cdn.animesice.io/skins/common6.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 7', imageUrl: 'https://cdn.animesice.io/skins/common7.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 8', imageUrl: 'https://cdn.animesice.io/skins/common8.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 9', imageUrl: 'https://cdn.animesice.io/skins/common9.webp', rarity: 'COMMON' },
  { name: 'Skin Comum 10', imageUrl: 'https://cdn.animesice.io/skins/common10.webp', rarity: 'COMMON' },
  // INCOMUM - 5
  { name: 'Skin Incomum 1', imageUrl: 'https://cdn.animesice.io/skins/uncommon1.webp', rarity: 'INCOMUM' },
  { name: 'Skin Incomum 2', imageUrl: 'https://cdn.animesice.io/skins/uncommon2.webp', rarity: 'INCOMUM' },
  { name: 'Skin Incomum 3', imageUrl: 'https://cdn.animesice.io/skins/uncommon3.webp', rarity: 'INCOMUM' },
  { name: 'Skin Incomum 4', imageUrl: 'https://cdn.animesice.io/skins/uncommon4.webp', rarity: 'INCOMUM' },
  { name: 'Skin Incomum 5', imageUrl: 'https://cdn.animesice.io/skins/uncommon5.webp', rarity: 'INCOMUM' },
  // RARA - 5
  { name: 'Skin Rara 1', imageUrl: 'https://cdn.animesice.io/skins/rare1.webp', rarity: 'RARA' },
  { name: 'Skin Rara 2', imageUrl: 'https://cdn.animesice.io/skins/rare2.webp', rarity: 'RARA' },
  { name: 'Skin Rara 3', imageUrl: 'https://cdn.animesice.io/skins/rare3.webp', rarity: 'RARA' },
  { name: 'Skin Rara 4', imageUrl: 'https://cdn.animesice.io/skins/rare4.webp', rarity: 'RARA' },
  { name: 'Skin Rara 5', imageUrl: 'https://cdn.animesice.io/skins/rare5.webp', rarity: 'RARA' },
  // EPICA - 3
  { name: 'Skin Épica 1', imageUrl: 'https://cdn.animesice.io/skins/epic1.webp', rarity: 'EPICA' },
  { name: 'Skin Épica 2', imageUrl: 'https://cdn.animesice.io/skins/epic2.webp', rarity: 'EPICA' },
  { name: 'Skin Épica 3', imageUrl: 'https://cdn.animesice.io/skins/epic3.webp', rarity: 'EPICA' },
  // LENDARIA - 2
  { name: 'Skin Lendária 1', imageUrl: 'https://cdn.animesice.io/skins/legendary1.webp', rarity: 'LENDARIA' },
  { name: 'Skin Lendária 2', imageUrl: 'https://cdn.animesice.io/skins/legendary2.webp', rarity: 'LENDARIA' },
  // MITICA - 1
  { name: 'Skin Mítica 1', imageUrl: 'https://cdn.animesice.io/skins/mythic1.webp', rarity: 'MITICA' },
  // GALACTICA - 1
  { name: 'Skin Galáctica 1', imageUrl: 'https://cdn.animesice.io/skins/galactica1.webp', rarity: 'GALACTICA' },
];

async function main() {
  for (const s of skins) {
    await prisma.gachaSkin.create({
      data: { ...s, active: true, blocked: false },
    });
    console.log(`✓ ${s.name} (${s.rarity})`);
  }
  console.log('Done. Total:', skins.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());