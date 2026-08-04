export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_PAGE = 1;

export function parsePageParam(
  value: string | undefined,
  defaultValue: number,
): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isNaN(parsed) || parsed < 1 ? defaultValue : parsed;
}
