import {
  Injectable,
  Inject,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';

/**
 * Guard JWT opcional — para rotas públicas (feed, diretório de usuários)
 * que querem personalizar a resposta (hasLiked/isFollowing) quando há um
 * token válido, sem exigir autenticação.
 *
 * Apenas falhas de autenticação são tratadas como anônimo; erros reais
 * (ex.: falha de banco na estratégia) continuam propagando.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // NestJS 12 usa getOwnMetadata p/ deps opcionais: o marker @Optional() do
  // AuthGuard mixin não é herdado por subclasses, então redeclaramos o ctor.
  constructor(
    @Optional() @Inject(AuthModuleOptions) options?: AuthModuleOptions,
  ) {
    super(options);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest<TUser = any>(err: any, user: any): TUser {
    if (err instanceof UnauthorizedException) {
      // Token ausente/inválido/expirado em rota pública → segue como anônimo.
      return null as TUser;
    }
    if (err) {
      throw err;
    }
    return user as TUser;
  }
}
