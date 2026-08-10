import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMetadata {
  action: string;
  resourceType: string;
}

export const Audit = (action: string, resourceType: string = 'General') =>
  SetMetadata(AUDIT_KEY, { action, resourceType });
