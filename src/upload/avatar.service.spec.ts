import { AvatarService } from '@/upload/avatar.service';
import type { PrismaService } from '@/prisma/prisma.service';

describe('AvatarService', () => {
  function build(rows: unknown[]) {
    const prisma = {
      $executeRaw: jest.fn(async () => 1),
      $queryRaw: jest.fn(async () => rows),
    };
    return {
      svc: new AvatarService(prisma as unknown as PrismaService),
      prisma,
    };
  }

  describe('save', () => {
    it('grava o avatar e devolve o path público', async () => {
      const { svc, prisma } = build([]);
      const buffer = Buffer.from('fake');

      const path = await svc.save('u1', buffer, 'image/png');

      expect(path).toBe('/avatars/u1');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('get', () => {
    it('retorna a linha encontrada', async () => {
      const row = { data: Buffer.from('x'), contentType: 'image/jpeg' };
      const { svc } = build([row]);

      await expect(svc.get('u1')).resolves.toBe(row);
    });

    it('retorna null quando não há avatar para o usuário', async () => {
      const { svc } = build([]);

      await expect(svc.get('u1')).resolves.toBeNull();
    });
  });
});
