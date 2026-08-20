import { AudioType } from '@prisma/client';

/**
 * O catálogo usa "Dublado" no próprio título para distinguir uma versão
 * dublada da versão legendada. Por isso, o título é a fonte de verdade do
 * tipo de áudio, e não um valor manual que pode ficar desatualizado.
 */
export function audioTypeFromTitle(title: string): AudioType {
  return /(^|[^\p{L}\p{N}])dublado([^\p{L}\p{N}]|$)/iu.test(title)
    ? AudioType.DUBLADO
    : AudioType.LEGENDADO;
}
