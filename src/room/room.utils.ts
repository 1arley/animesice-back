import { randomBytes } from 'crypto';

export function generateRoomSlug(): string {
  return randomBytes(6).toString('base64url').slice(0, 10);
}
