import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

export function backendOrigin(
  req: Request,
  trustProxy: boolean,
  configService: ConfigService,
): string {
  const envUrl =
    configService.get<string>('PUBLIC_BACKEND_URL') ??
    configService.get<string>('BACKEND_URL');
  if (envUrl) return envUrl.replace(/\/+$/, '');

  let host = req.headers.host ?? 'localhost:3000';
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-host'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      host = forwarded.split(',')[0]!.trim();
    }
  }
  const protocol = trustProxy ? 'https' : req.protocol;
  return `${protocol}://${host}`;
}
