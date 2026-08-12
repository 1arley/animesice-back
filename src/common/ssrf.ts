import { BadRequestException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import net from 'net';

const BLOCKED_MESSAGE =
  'Destino bloqueado: não é permitido acesso a redes internas ou metadata.';

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const o = ip.split('.').map((p) => parseInt(p, 10));
    if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true;
    if (o[0] === 127) return true; // loopback
    if (o[0] === 10) return true; // 10.0.0.0/8
    if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true; // 172.16.0.0/12
    if (o[0] === 192 && o[1] === 168) return true; // 192.168.0.0/16
    if (o[0] === 169 && o[1] === 254) return true; // link-local
    if (o[0] === 100 && o[1]! >= 64 && o[1]! <= 127) return true; // CGNAT
    if (o[0] === 0) return true; // 0.0.0.0/8
    if (o[0]! >= 224) return true; // multicast / reserved
    return false;
  }
  if (family === 6) {
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::') return true;
    if (norm.startsWith('fe80:')) return true; // link-local
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // ULA
    if (norm.startsWith('::ffff:')) {
      const ipv4 = norm.replace('::ffff:', '');
      return isBlockedIp(ipv4);
    }
    return false;
  }
  return true;
}

export function isBlockedHostname(host: string): boolean {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (clean === 'localhost' || clean === 'metadata.google.internal') {
    return true;
  }
  const family = net.isIP(clean);
  if (family !== 0) return isBlockedIp(clean);

  // Hex/octal IPv4 check
  if (/^(0x[0-9a-f]+|[0-7]+)(\.(0x[0-9a-f]+|[0-7]+)){3}$/i.test(clean)) {
    return true;
  }
  return false;
}

export async function assertHostResolvesSafely(urlStr: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new BadRequestException('URL malformada.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Scheme inválido.');
  }

  const host = parsed.hostname;
  if (isBlockedHostname(host)) {
    throw new BadRequestException(BLOCKED_MESSAGE);
  }

  if (net.isIP(host)) return;

  let addresses: readonly { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException(
      'Destino bloqueado: o host não pôde ser resolvido.',
    );
  }

  if (addresses.length === 0) {
    throw new BadRequestException(
      'Destino bloqueado: o host não resolveu para nenhum endereço.',
    );
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr.address)) {
      throw new BadRequestException(BLOCKED_MESSAGE);
    }
  }
}
