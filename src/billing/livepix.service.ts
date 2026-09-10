import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TOKEN_URL = 'https://oauth.livepix.gg/oauth2/token';
const API_URL = 'https://api.livepix.gg';

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface CreateMessageResponse {
  data: { reference: string; redirectUrl: string };
}

interface PaymentRecord {
  reference?: string;
  amount?: number;
}

export interface LivePixCheckout {
  reference: string;
  checkoutUrl: string;
}

@Injectable()
export class LivePixService {
  private readonly logger = new Logger(LivePixService.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('LIVEPIX_CLIENT_ID') &&
      this.config.get<string>('LIVEPIX_CLIENT_SECRET'),
    );
  }

  async createBypassCharge(
    _username: string,
    amountCents: number,
    redirectUrl: string,
  ): Promise<LivePixCheckout> {
    const token = await this.accessToken();
    const res = await fetch(`${API_URL}/v2/payments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountCents,
        currency: 'BRL',
        redirectUrl,
      }),
    });
    if (!res.ok) {
      this.logger.warn(`LivePix create message falhou: ${res.status}`);
      throw new ServiceUnavailableException(
        'Pagamento indisponível no momento. Tente novamente.',
      );
    }
    const data = (await res.json()) as CreateMessageResponse;
    return {
      reference: data.data.reference,
      checkoutUrl: data.data.redirectUrl,
    };
  }

  async isPaid(reference: string, minAmountCents: number): Promise<boolean> {
    const token = await this.accessToken();
    const url = new URL(`${API_URL}/v2/payments`);
    url.searchParams.set('reference', reference);
    url.searchParams.set('limit', '5');
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { data: PaymentRecord[] };
    return data.data.some(
      (payment) =>
        payment.reference === reference &&
        (payment.amount ?? 0) >= minAmountCents,
    );
  }

  private async accessToken(): Promise<string> {
    if (this.token !== null && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    const clientId = this.config.get<string>('LIVEPIX_CLIENT_ID');
    const clientSecret = this.config.get<string>('LIVEPIX_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'Pagamento indisponível no momento. Tente novamente.',
      );
    }
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'messages:write payments:read',
      }),
    });
    if (!res.ok) {
      this.logger.warn(`LivePix OAuth falhou: ${res.status}`);
      throw new ServiceUnavailableException(
        'Pagamento indisponível no momento. Tente novamente.',
      );
    }
    const data = (await res.json()) as TokenResponse;
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }
}
