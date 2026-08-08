import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class TurnstileService {
  private readonly siteverify =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  async verify(token: string, secret?: string): Promise<void> {
    const expectedSecret = secret ?? process.env.TURNSTILE_SECRET;

    if (!expectedSecret) return;

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
        const data: { success?: boolean; error_codes?: string[] } =
          await res.json();
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
