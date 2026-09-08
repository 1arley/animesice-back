import {
  Injectable,
  Inject,
  Optional,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';
import { Observable } from 'rxjs';

@Injectable()
export class JwtRefreshAuthGuard
  extends AuthGuard('jwt-refresh')
  implements CanActivate
{
  // NestJS 12 usa getOwnMetadata p/ deps opcionais: o marker @Optional() do
  // AuthGuard mixin não é herdado por subclasses, então redeclaramos o ctor.
  constructor(
    @Optional() @Inject(AuthModuleOptions) options?: AuthModuleOptions,
  ) {
    super(options);
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return super.canActivate(context);
  }
}
