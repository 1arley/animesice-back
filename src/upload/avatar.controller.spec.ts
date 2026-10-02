import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { AvatarController } from '@/upload/avatar.controller';
import { AvatarService } from '@/upload/avatar.service';

describe('AvatarController', () => {
  function build(avatar: { data: Buffer; contentType: string } | null) {
    const avatars = {
      get: jest.fn(async () => avatar),
    } as unknown as AvatarService;
    const res = {
      set: jest.fn(),
      send: jest.fn(),
    };
    return {
      controller: new AvatarController(avatars),
      avatars,
      res: res as unknown as Response & { set: jest.Mock; send: jest.Mock },
    };
  }

  it('serve o avatar com content-type e cache público', async () => {
    const data = Buffer.from('fake-png');
    const { controller, res } = build({ data, contentType: 'image/png' });

    await controller.getAvatar('u1', res);

    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
    expect(res.send).toHaveBeenCalledWith(data);
  });

  it('lança NotFoundException quando o usuário não tem avatar', async () => {
    const { controller, res } = build(null);

    await expect(controller.getAvatar('u1', res)).rejects.toThrow(
      NotFoundException,
    );
    await expect(controller.getAvatar('u1', res)).rejects.toThrow(
      'Avatar não encontrado.',
    );
    expect(res.send).not.toHaveBeenCalled();
  });
});
