import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Request } from 'express';

export interface AuditLogInput {
  adminId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress: string;
  userAgent?: string;
  status?: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
  dataAccessed?: number;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          adminId: input.adminId,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          status: input.status || 'SUCCESS',
          errorMessage: input.errorMessage,
          dataAccessed: input.dataAccessed,
        },
      });
    } catch (error) {
      console.error('Failed to log audit:', error);
      // Não lance erro - auditoria não deve quebrar a aplicação
    }
  }

  async logRequest(
    adminId: string,
    action: string,
    resourceType: string,
    req: Request,
    resourceId?: string,
    dataAccessed?: number,
  ): Promise<void> {
    const ipAddress = this.getClientIp(req);
    const userAgent = req.get('user-agent');

    await this.log({
      adminId,
      action,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      dataAccessed,
    });
  }

  async logError(
    adminId: string,
    action: string,
    resourceType: string,
    req: Request,
    error: Error,
    resourceId?: string,
  ): Promise<void> {
    const ipAddress = this.getClientIp(req);
    const userAgent = req.get('user-agent');

    await this.log({
      adminId,
      action,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      status: 'FAILED',
      errorMessage: error.message,
    });
  }

  private getClientIp(req: Request): string {
    const forwarded = req.get('x-forwarded-for');
    if (forwarded) {
      return (forwarded.split(',')[0] ?? '').trim();
    }
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  async getAdminActivity(adminId: string, limit: number = 50) {
    return this.prisma.adminAuditLog.findMany({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getSensitiveDataAccess(
    resourceType: string = 'User',
    days: number = 7,
  ) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.prisma.adminAuditLog.findMany({
      where: {
        resourceType,
        createdAt: { gte: since },
        action: {
          in: ['LIST_USERS', 'VIEW_USER', 'LIST_EMAILS'],
        },
      },
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
