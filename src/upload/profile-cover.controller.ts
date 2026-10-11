import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AvatarService } from '@/upload/avatar.service';
import { PrismaService } from '@/prisma/prisma.service';

@Controller('profile-covers')
export class ProfileCoverController {
  constructor(
    private readonly avatars: AvatarService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':userId')
  async getProfileCover(@Param('userId') userId: string, @Res() res: Response) {
    const privacy = await this.prisma.privacySettings.findUnique({
      where: { userId },
      select: { profilePublic: true },
    });
    if (privacy && !privacy.profilePublic) {
      throw new NotFoundException('Capa não encontrada.');
    }
    const cover = await this.avatars.getProfileCover(userId);
    if (!cover) throw new NotFoundException('Capa não encontrada.');
    res.set({
      'Content-Type': cover.contentType,
      'Cache-Control': 'no-store',
    });
    res.send(cover.data);
  }
}
