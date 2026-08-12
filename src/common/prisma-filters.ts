import type { Prisma } from '@prisma/client';

/**
 * Filtro de relação User — "perfil público" (privacidade ausente = público).
 *
 * Usado nas listas de seguidores/seguindo, nos contadores do perfil e em
 * qualquer lugar que liste usuários publicamente, para manter o mesmo
 * critério do feed global (COALESCE(p."profilePublic", true) = true).
 */
export const PROFILE_PUBLIC_OR_EMPTY = {
  OR: [{ privacySettings: null }, { privacySettings: { profilePublic: true } }],
} satisfies Prisma.UserWhereInput;
