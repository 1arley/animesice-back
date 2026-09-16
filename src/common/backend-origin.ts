import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/i;

export function backendOrigin(
  req: Request,
  trustProxy: boolean,
  configService: ConfigService,
): string {
  const envUrl =
    configService.get<string>('PUBLIC_BACKEND_URL') ??
    configService.get<string>('BACKEND_URL');
  if (envUrl) return envUrl.replace(/\/+$/, '');

  const allowedHosts = (configService.get<string>('PUBLIC_BACKEND_HOSTS') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  let host: string | undefined;
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-host'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      host = forwarded.split(',')[0]!.trim();
    }
  }
  if (!host) {
    const direct = req.headers['host'];
    if (typeof direct === 'string') host = direct;
  }

  if (host && HOSTNAME_RE.test(host)) {
    const hostOnly = host.replace(/:\d+$/, '').toLowerCase();
    if (allowedHosts.length > 0) {
      if (
        allowedHosts.includes(host.toLowerCase()) ||
        allowedHosts.includes(hostOnly)
      ) {
        const scheme =
          trustProxy &&
          typeof req.headers['x-forwarded-proto'] === 'string' &&
          /^https?$/i.test(req.headers['x-forwarded-proto'])
            ? String(req.headers['x-forwarded-proto']).toLowerCase()
            : 'https';
        return `${scheme}://${host}`;
      }
    } else {
      if (process.env.NODE_ENV !== 'production') {
        return `${req.protocol}://${host}`;
      }
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenException(
      'PUBLIC_BACKEND_URL ou PUBLIC_BACKEND_HOSTS não configurados.',
    );
  }
  return 'http://localhost';
}
