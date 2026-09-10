import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class TurnstileService {
  private readonly siteverify =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  async verify(token: string | undefined, secret?: string): Promise<void> {
    const expectedSecret = secret ?? process.env.TURNSTILE_SECRET;

    if (!expectedSecret) {
      // Fail-closed em produção: captcha desativado por config faltante não
      // pode abrir brecha silenciosa (mesma postura do EMBED_ALLOWED_HOSTS).
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException(
          'CAPTCHA indisponível. Contate o suporte.',
        );
      }
      return;
    }

    if (!token) {
      throw new UnauthorizedException(
        'Captcha obrigatório. Atualize a página e tente novamente.',
      );
    }

    let verified = false;
    try {
      const res = await fetch(this.siteverify, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: expectedSecret,
          response: token,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          success?: boolean;
          error_codes?: string[];
        };
        verified = !!data.success;
      }
    } catch {
      verified = false;
    }

    if (!verified) {
      throw new UnauthorizedException(
        'Falha na verificação do captcha. Tente novamente.',
      );
    }
  }
}
