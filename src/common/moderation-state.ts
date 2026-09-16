import { ModerationActionType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export async function hasActiveRestriction(
  prisma: PrismaService,
  userId: string,
  actionTypes?: ModerationActionType[],
): Promise<boolean> {
  const now = new Date();
  const where: Record<string, unknown> = {
    userId,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  if (actionTypes && actionTypes.length > 0) {
    where.actionType = { in: actionTypes };
  }
  const count = await prisma.moderationAction.count({ where });
  return count > 0;
}
