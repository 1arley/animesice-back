export function normalizeAnimeTitle(title: string | null | undefined): string {
  return (title ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\b(\d+)(?:st|nd|rd|th)[\s-]*season\b/g, '$1')
    .replace(/\bseason[\s-]*(\d+)\b/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
