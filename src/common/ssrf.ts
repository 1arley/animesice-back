import { BadRequestException, BadGatewayException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import net, { LookupFunction } from 'net';
import { Agent, Dispatcher, fetch as undiciFetch } from 'undici';

const BLOCKED_MESSAGE =
  'Destino bloqueado: não é permitido acesso a redes internas ou metadata.';

const blockedNetworks = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
] as const) {
  blockedNetworks.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedNetworks.addSubnet(network, prefix, 'ipv6');
}

export interface SafeUrlResolution {
  url: string;
  hostname: string;
  addresses: ReadonlyArray<{ address: string; family: 4 | 6 }>;
  lookup: LookupFunction;
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blockedNetworks.check(ip, 'ipv4');
  if (family === 6) return blockedNetworks.check(ip, 'ipv6');
  return true;
}

export function isBlockedHostname(host: string): boolean {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (clean === 'localhost' || clean === 'metadata.google.internal')
    return true;
  if (net.isIP(clean)) return isBlockedIp(clean);
  return /^(0x[0-9a-f]+|[0-7]+)(\.(0x[0-9a-f]+|[0-7]+)){3}$/i.test(clean);
}

/**
 * Valida a URL e resolve o DNS uma única vez. O lookup retornado só entrega
 * os IPs desta resolução, eliminando a janela de DNS rebinding entre check e
 * connect. Todos os endereços precisam ser públicos (fail closed).
 */
export async function resolveSafeUrl(
  urlStr: string,
): Promise<SafeUrlResolution> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new BadRequestException('URL malformada.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Scheme inválido.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname))
    throw new BadRequestException(BLOCKED_MESSAGE);

  let addresses: Array<{ address: string; family: 4 | 6 }>;
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily as 4 | 6 }];
  } else {
    try {
      const found = await lookup(hostname, { all: true, verbatim: true });
      addresses = found.map(({ address, family }) => ({
        address,
        family: family as 4 | 6,
      }));
    } catch {
      throw new BadRequestException(
        'Destino bloqueado: o host não pôde ser resolvido.',
      );
    }
  }
  if (addresses.length === 0) {
    throw new BadRequestException(
      'Destino bloqueado: o host não resolveu para nenhum endereço.',
    );
  }
  if (addresses.some(({ address }) => isBlockedIp(address))) {
    throw new BadRequestException(BLOCKED_MESSAGE);
  }

  const pinned = Object.freeze(addresses.map((entry) => Object.freeze(entry)));
  const pinnedLookup: LookupFunction = (requestedHost, options, callback) => {
    const requested = requestedHost.toLowerCase().replace(/^\[|\]$/g, '');
    if (requested !== hostname) {
      callback(
        new Error('Dispatcher SSRF recusou hostname não validado'),
        '',
        0,
      );
      return;
    }
    const opts = typeof options === 'object' ? options : {};
    const candidates = opts.family
      ? pinned.filter(({ family }) => family === opts.family)
      : pinned;
    if (candidates.length === 0) {
      callback(
        new Error('Nenhum IP validado para a família solicitada'),
        '',
        0,
      );
      return;
    }
    if (opts.all) callback(null, [...candidates]);
    else callback(null, candidates[0]!.address, candidates[0]!.family);
  };

  return {
    url: parsed.toString(),
    hostname,
    addresses: pinned,
    lookup: pinnedLookup,
  };
}

/** Dispatcher por hop: ignora o dispatcher global/proxy e conecta no IP pinado. */
export function pinnedDispatcher(resolution: SafeUrlResolution): Dispatcher {
  return new Agent({ connect: { lookup: resolution.lookup } });
}

/** Compatibilidade para callers que só precisam validar, sem fazer request. */
export async function assertHostResolvesSafely(urlStr: string): Promise<void> {
  await resolveSafeUrl(urlStr);
}

/** Máximo de redirecionamentos antes de abortar (anti-loop SSRF). */
const MAX_REDIRECTS = 5;

/**
 * Fetch SSRF-safe standalone: valida cada hop via DNS-pinned resolution,
 * bloqueia IPs internos e segue redirecionamentos com revalidação manual.
 * Uso: fontes de scrape que precisam de fetch protegido sem depender do
 * EmbedService.
 */
export async function fetchSafeRaw(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; dispatcher: Dispatcher }> {
  let current = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const resolution = await resolveSafeUrl(current);
    const dispatcher = pinnedDispatcher(resolution);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await undiciFetch(resolution.url, {
        ...init,
        signal: controller.signal,
        redirect: 'manual',
        dispatcher,
      });
    } catch (err) {
      await dispatcher.close();
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get('location');
    const isRedirect =
      response.status >= 300 && response.status < 400 && !!location;
    if (!isRedirect) return { response, dispatcher };

    await response.body?.cancel();
    await dispatcher.close();
    try {
      current = new URL(location, resolution.url).toString();
    } catch {
      throw new BadGatewayException('Redirecionamento upstream inválido.');
    }
  }

  throw new BadGatewayException('Limite de redirecionamentos excedido.');
}
