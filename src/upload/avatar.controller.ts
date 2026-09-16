import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { AvatarService } from '@/upload/avatar.service';

@Controller('avatars')
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Get(':userId')
  async getAvatar(@Param('userId') userId: string, @Res() res: Response) {
    const avatar = await this.avatars.get(userId);
    if (!avatar) {
      throw new NotFoundException('Avatar não encontrado.');
    }
    res.set({
      'Content-Type': avatar.mimetype,
      'Cache-Control': 'public, max-age=86400',
    });
    res.send(avatar.data);
  }
}
