export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_PAGE = 1;
export const MAX_PAGE_SIZE = 100;
export const BCRYPT_ROUNDS = 12;

export function parsePageParam(
  value: string | undefined,
  defaultValue: number,
  max: number = MAX_PAGE_SIZE,
): number {
  const parsed = parseInt(value ?? '', 10);
  if (Number.isNaN(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}
