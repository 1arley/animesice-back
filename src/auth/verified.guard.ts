import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@Injectable()
export class VerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!user) {
      throw new ForbiddenException('Usuário não autenticado.');
    }

    if (!user.isVerified) {
      throw new ForbiddenException(
        'Conta não verificada. Verifique seu email para continuar.',
      );
    }

    return true;
  }
}
