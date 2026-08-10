import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { AUDIT_KEY, AuditMetadata } from '@/auth/decorators/audit.decorator';
import { AuditService } from '@/common/services/audit.service';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import { throwError } from 'rxjs';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMetadata = this.reflector.getAllAndOverride<AuditMetadata>(
      AUDIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Se não há auditoria configurada, passa adiante
    if (!auditMetadata) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;

    // Se não há usuário autenticado, não audita
    if (!user) {
      return next.handle();
    }

    const { action, resourceType } = auditMetadata;
    let dataAccessed = 0;

    return next.handle().pipe(
      tap((response) => {
        // Contar quantos registros foram acessados
        if (Array.isArray(response)) {
          dataAccessed = response.length;
        } else if (response && typeof response === 'object') {
          const payload = response as Record<string, unknown>;
          if (Array.isArray(payload.data)) {
            dataAccessed = payload.data.length;
          } else if (
            payload.meta !== null &&
            typeof payload.meta === 'object' &&
            'total' in payload.meta
          ) {
            dataAccessed = (payload.meta as { total?: number }).total ?? 1;
          } else {
            dataAccessed = 1;
          }
        }

        // Log da auditoria de forma assíncrona (não aguarda)
        this.auditService
          .logRequest(
            user.id,
            action,
            resourceType,
            req,
            undefined,
            dataAccessed,
          )
          .catch((error) => {
            console.error('Audit log failed:', error);
          });
      }),
      catchError((error) => {
        // Log de erro da auditoria
        this.auditService
          .logError(user.id, action, resourceType, req, error as Error)
          .catch((auditError) => {
            console.error('Audit error log failed:', auditError);
          });

        return throwError(() => error as Error);
      }),
    );
  }
}
