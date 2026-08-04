import { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  refreshToken?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
