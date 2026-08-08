import { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  isVerified: boolean;
  refreshToken?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
