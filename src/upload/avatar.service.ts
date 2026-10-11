import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

export const ALLOWED_IMAGE_MIMETYPES = ['image/jpeg', 'image/png'];
export const MAX_AVATAR_BYTES = 1024 * 1024;
export const MAX_PROFILE_COVER_BYTES = 1024 * 1024;

@Injectable()
export class AvatarService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    userId: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<string> {
    await this.prisma.$executeRaw`
      INSERT INTO "AvatarFile" ("userId", "data", "contentType", "updatedAt")
      VALUES (${userId}, ${buffer}, ${mimetype}, CURRENT_TIMESTAMP)
      ON CONFLICT ("userId") DO UPDATE SET
        "data" = EXCLUDED."data",
        "contentType" = EXCLUDED."contentType",
        "updatedAt" = CURRENT_TIMESTAMP
    `;
    return `/avatars/${userId}`;
  }

  async get(
    userId: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const rows = await this.prisma.$queryRaw<
      unknown[]
    >`SELECT "data", "contentType" FROM "AvatarFile" WHERE "userId" = ${userId} LIMIT 1`;
    return (rows[0] as { data: Buffer; contentType: string }) ?? null;
  }

  async saveProfileCover(userId: string, buffer: Buffer, mimetype: string) {
    await this.prisma.$executeRaw`
      INSERT INTO "ProfileCoverFile" ("userId", "data", "contentType", "updatedAt")
      VALUES (${userId}, ${buffer}, ${mimetype}, CURRENT_TIMESTAMP)
      ON CONFLICT ("userId") DO UPDATE SET
        "data" = EXCLUDED."data",
        "contentType" = EXCLUDED."contentType",
        "updatedAt" = CURRENT_TIMESTAMP
    `;
  }

  async getProfileCover(userId: string) {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT "data", "contentType" FROM "ProfileCoverFile"
      WHERE "userId" = ${userId} LIMIT 1
    `;
    return (rows[0] as { data: Buffer; contentType: string }) ?? null;
  }

  async deleteProfileCover(userId: string) {
    await this.prisma.$executeRaw`
      DELETE FROM "ProfileCoverFile" WHERE "userId" = ${userId}
    `;
  }
}
