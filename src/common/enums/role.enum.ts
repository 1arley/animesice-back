import { Role } from '@prisma/client';

export const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.USER]: 1,
  [Role.ADMIN]: 2,
  [Role.SUPERADMIN]: 3,
};
