/**
 * Hosts de mídia que o NOSSO scraper validou.
 *
 * A allowlist `EMBED_ALLOWED_HOSTS` é estática e quebra: em 13/10/2026 o
 * topanimes passou a servir HLS de um CDN que **muda por episódio** e não tem
 * domínio comum (onfilom.com, 123flmsfree.com, 321moviesfree.com,
 * cuevana4br.com, peliculaplay.com, solo-latino.com...). Manter a lista na mão
 * é uma esteira sem fim, e sem o host o proxy responde "Host de destino não
 * permitido" e o episódio não toca.
 *
 * A confiança aqui é por PROCEDÊNCIA, não por allowlist: um host entra no
 * conjunto quando o scraper extrai uma URL de mídia naquele host e a persiste
 * em `Episode.videoUrl`. Como a extração já passou por `probeMediaUrlDead`
 * (confere que o host responde 200/206), o host é real e externo.
 *
 * Isto NÃO abre SSRF: `isBlockedHostname` continua sendo avaliado antes, e o
 * atacante só consegue indicar hosts que nós mesmos gravamos — nunca um host
 * interno escolhido por ele.
 */

export const MEDIA_HOST_TRUST_TTL_MS = 24 * 60 * 60_000;

/** host (lowercase, sem porta) -> expiry timestamp, or null for durable trust. */
const trustedHosts = new Map<string, number | null>();

function normalize(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  try {
    // Aceita URL completa ou host cru.
    const host = /^https?:\/\//i.test(raw) ? new URL(raw).hostname : raw;
    return host.replace(/:\d+$/, '') || null;
  } catch {
    return null;
  }
}

/** Registra o host de uma URL de mídia que o scraper acabou de validar. */
export function trustMediaHost(
  urlOrHost: string,
  expiresAt?: Date | number | null,
): void {
  const host = normalize(urlOrHost);
  if (!host) return;
  const expiry =
    expiresAt instanceof Date ? expiresAt.getTime() : (expiresAt ?? null);
  const current = trustedHosts.get(host);
  if (
    current === null ||
    (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now()))
  ) {
    return;
  }
  if (expiry === null || current === undefined || expiry > current) {
    trustedHosts.set(host, expiry);
  }
}

/** Registra vários de uma vez (uma extração pode trazer várias qualidades). */
export function trustMediaHosts(
  urls: Iterable<string>,
  expiresAt?: Date | number | null,
): void {
  for (const url of urls) trustMediaHost(url, expiresAt);
}

export function isTrustedMediaHost(host: string): boolean {
  const normalized = normalize(host);
  if (normalized === null || !trustedHosts.has(normalized)) return false;
  const expiry = trustedHosts.get(normalized);
  if (expiry !== null && expiry !== undefined && expiry <= Date.now()) {
    trustedHosts.delete(normalized);
    return false;
  }
  return true;
}

/** Quantidade de hosts confiáveis (métrica/diagnóstico). */
export function trustedMediaHostCount(): number {
  for (const host of trustedHosts.keys()) isTrustedMediaHost(host);
  return trustedHosts.size;
}

/** Substitui o conjunto inteiro — usado no warm-up a partir do banco. */
export function replaceTrustedMediaHosts(hosts: Iterable<string>): number {
  trustedHosts.clear();
  for (const host of hosts) trustMediaHost(host);
  return trustedHosts.size;
}

/** Visível para testes, evitando estado global entre casos. */
export function clearTrustedMediaHosts(): void {
  trustedHosts.clear();
}
