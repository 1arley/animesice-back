import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export const ESSENCE_RARITIES = {
  ESSENCIA_COMUM: 'COMUM',
  ESSENCIA_INCOMUM: 'INCOMUM',
  ESSENCIA_RARA: 'RARA',
  ESSENCIA_EPICA: 'EPICA',
  ESSENCIA_LENDARIA: 'LENDARIA',
  ESSENCIA_MITICA: 'MITICA',
  ESSENCIA_GALACTICA: 'GALACTICA',
} as const;
export type EssenceKind = keyof typeof ESSENCE_RARITIES;
export const ESSENCE_KINDS = Object.keys(ESSENCE_RARITIES) as EssenceKind[];

export const ITEM_CATALOG = [
  {
    id: 'TITANITA_SHARD',
    name: 'Fragmento de Titanita',
    field: 'titanitaShards',
  },
  {
    id: 'TITANITA_SOMBRIA_SHARD',
    name: 'Fragmento de Titanita Sombria',
    field: 'titanitaSombriaShards',
  },
  {
    id: 'DRACONICA_SHARD',
    name: 'Fragmento Dracônico',
    field: 'draconicaShards',
  },
  {
    id: 'SOMBRIA_DRACONICA_SHARD',
    name: 'Fragmento Sombrio Dracônico',
    field: 'sombriaDraconicaShards',
  },
  { id: 'TITANITA', name: 'Titanita', field: 'titanitaItems' },
  {
    id: 'TITANITA_SOMBRIA',
    name: 'Titanita Sombria',
    field: 'titanitaSombriaItems',
  },
  { id: 'DRACONICA', name: 'Dracônica', field: 'draconicaItems' },
  {
    id: 'SOMBRIA_DRACONICA',
    name: 'Sombria Dracônica',
    field: 'sombriaDraconicaItems',
  },
  { id: 'PROTECAO', name: 'Proteção de reroll', field: 'protecao' },
  { id: 'EXTRATOR_FOIL', name: 'Extrator de Foil', field: 'foilExtractors' },
  { id: 'COMMON_BOX', name: 'Baú comum', field: 'commonBoxes' },
  { id: 'RARE_BOX', name: 'Baú raro', field: 'rareBoxes' },
  { id: 'PREMIUM_BOX', name: 'Baú premium', field: 'premiumBoxes' },
  { id: 'KEY', name: 'Chave', field: 'keys' },
  { id: 'SPIN_RESET', name: 'Reset de giros', field: 'spinResets' },
  { id: 'HOLO_SHARD', name: 'Fragmento Holo', field: 'holoShards' },
  { id: 'GOLD_SHARD', name: 'Fragmento Gold', field: 'goldShards' },
  { id: 'INK_SHARD', name: 'Fragmento Ink', field: 'inkShards' },
  { id: 'PRISM_SHARD', name: 'Fragmento Prism', field: 'prismShards' },
  { id: 'HOLO_GEM', name: 'Gema Holo', field: 'holoGems' },
  { id: 'GOLD_GEM', name: 'Gema Gold', field: 'goldGems' },
  { id: 'INK_GEM', name: 'Gema Ink', field: 'inkGems' },
  { id: 'PRISM_GEM', name: 'Gema Prism', field: 'prismGems' },
  { id: 'ESSENCIA_COMUM', name: 'Essência Comum', field: 'essenciaComum' },
  {
    id: 'ESSENCIA_INCOMUM',
    name: 'Essência Incomum',
    field: 'essenciaIncomum',
  },
  { id: 'ESSENCIA_RARA', name: 'Essência Rara', field: 'essenciaRara' },
  { id: 'ESSENCIA_EPICA', name: 'Essência Épica', field: 'essenciaEpica' },
  {
    id: 'ESSENCIA_LENDARIA',
    name: 'Essência Lendária',
    field: 'essenciaLendaria',
  },
  { id: 'ESSENCIA_MITICA', name: 'Essência Mítica', field: 'essenciaMitica' },
  {
    id: 'ESSENCIA_GALACTICA',
    name: 'Essência Galáctica',
    field: 'essenciaGalactica',
  },
] as const;

export type CatalogItemId = (typeof ITEM_CATALOG)[number]['id'];
export type ItemAmount = { itemId: CatalogItemId; quantity: number };
export const CATALOG_ITEM_IDS = ITEM_CATALOG.map((item) => item.id);
const MAX_INT = 2_147_483_647;

export function catalogItem(itemId: string) {
  const item = ITEM_CATALOG.find((entry) => entry.id === itemId);
  if (!item) throw new BadRequestException('Item desconhecido.');
  return item;
}

export function catalogItemForField(field: string) {
  const item = ITEM_CATALOG.find((entry) => entry.field === field);
  if (!item) throw new BadRequestException('Campo de inventário desconhecido.');
  return item;
}

export function itemAmounts(value: unknown): ItemAmount[] {
  if (!Array.isArray(value) || value.length > ITEM_CATALOG.length)
    throw new BadRequestException('Pacote de itens inválido.');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new BadRequestException('Item inválido.');
    const row = entry as Record<string, unknown>;
    if (typeof row.itemId !== 'string')
      throw new BadRequestException('Item inválido.');
    const item = catalogItem(row.itemId);
    if (seen.has(item.id)) throw new BadRequestException('Item duplicado.');
    seen.add(item.id);
    const quantity = row.quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_INT
    )
      throw new BadRequestException('Quantidade de item inválida.');
    return { itemId: item.id, quantity };
  });
}

export async function lockInventory(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.gachaInventory.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  await tx.$queryRaw`SELECT "userId" FROM "GachaInventory" WHERE "userId" = ${userId} FOR UPDATE`;
}

export async function creditItems(
  tx: Prisma.TransactionClient,
  userId: string,
  items: ItemAmount[],
) {
  if (!items.length) return;
  await lockInventory(tx, userId);
  for (const entry of items) {
    const field = catalogItem(entry.itemId).field;
    const [reserved] = await tx.$queryRaw<Array<{ quantity: bigint }>>`
      SELECT
        COALESCE((
          SELECT SUM("quantity")::bigint
          FROM "GachaItemListing"
          WHERE "userId" = ${userId}
            AND "itemId" = ${entry.itemId}
            AND "status" = 'ACTIVE'
        ), 0)::bigint
        + COALESCE((
          SELECT SUM((reward.value->>'quantity')::bigint)
          FROM "GachaMarketOffer" AS offer,
            LATERAL jsonb_array_elements(offer."offeredItems") AS reward(value)
          WHERE offer."offeredUserId" = ${userId}
            AND offer."status" = 'PENDING'
            AND reward.value->>'itemId' = ${entry.itemId}
        ), 0)::bigint
        + COALESCE((
          SELECT SUM((item.value->>'quantity')::bigint)
          FROM "GachaTrade" AS trade,
            LATERAL jsonb_array_elements(trade."itemsOffered") AS item(value)
          WHERE trade."offeredUserId" = ${userId}
            AND trade."status" = 'PENDING'
            AND item.value->>'itemId' = ${entry.itemId}
        ), 0)::bigint
        + COALESCE((
          SELECT SUM((item.value->>'quantity')::bigint)
          FROM "GachaTrade" AS trade,
            LATERAL jsonb_array_elements(trade."itemsRequested") AS item(value)
          WHERE trade."requestedUserId" = ${userId}
            AND trade."status" = 'PENDING'
            AND item.value->>'itemId' = ${entry.itemId}
        ), 0)::bigint AS quantity
    `;
    const reservedQuantity = Number(reserved?.quantity ?? 0);
    const result = await tx.gachaInventory.updateMany({
      where: {
        userId,
        [field]: { lte: MAX_INT - entry.quantity - reservedQuantity },
      },
      data: { [field]: { increment: entry.quantity } },
    });
    // Conflito de estado (409), não request malformado: o limite é do
    // inventário atual, igual ao comportamento anterior do burn.
    if (result.count !== 1)
      throw new ConflictException('Limite de inventário atingido.');
  }
}

export async function reserveItems(
  tx: Prisma.TransactionClient,
  userId: string,
  items: ItemAmount[],
) {
  if (!items.length) return;
  await lockInventory(tx, userId);
  for (const entry of items) {
    const field = catalogItem(entry.itemId).field;
    const result = await tx.gachaInventory.updateMany({
      where: { userId, [field]: { gte: entry.quantity } },
      data: { [field]: { decrement: entry.quantity } },
    });
    if (result.count !== 1)
      throw new BadRequestException('Itens disponíveis insuficientes.');
  }
}
