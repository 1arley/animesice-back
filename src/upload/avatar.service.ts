import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

export const ALLOWED_IMAGE_MIMETYPES = ['image/jpeg', 'image/png'];
export const MAX_AVATAR_BYTES = 1024 * 1024;

@Injectable()
export class AvatarService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    userId: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<string> {
    await this.prisma.$executeRaw`
      INSERT INTO "AvatarFile" ("userId", "data", "contentType")
      VALUES (${userId}, ${buffer}, ${mimetype})
      ON CONFLICT ("userId") DO UPDATE SET
        "data" = EXCLUDED."data",
        "contentType" = EXCLUDED."contentType"
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
}
