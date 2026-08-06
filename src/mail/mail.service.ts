import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly workerUrl: string | undefined;
  private readonly workerToken: string | undefined;
  private readonly cfAccessClientId: string | undefined;
  private readonly cfAccessClientSecret: string | undefined;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    this.workerUrl = this.configService.get<string>('MAIL_WORKER_URL');
    this.workerToken = this.configService.get<string>('MAIL_WORKER_TOKEN');
    this.cfAccessClientId = this.configService.get<string>(
      'CF_ACCESS_CLIENT_ID',
    );
    this.cfAccessClientSecret = this.configService.get<string>(
      'CF_ACCESS_CLIENT_SECRET',
    );
    this.fromName =
      this.configService.get<string>('MAIL_FROM_NAME') || 'AnimesIce';
  }

  async send(payload: MailPayload): Promise<boolean> {
    if (!this.workerUrl) {
      this.logger.warn(
        `MAIL_WORKER_URL not set — skipping email to ${payload.to}`,
      );
      return false;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Cloudflare Access service token authentication — required when the
      // Worker is behind CF Access. The Access policy validates these headers
      // before the request reaches the Worker.
      if (this.cfAccessClientId && this.cfAccessClientSecret) {
        headers['CF-Access-Client-Id'] = this.cfAccessClientId;
        headers['CF-Access-Client-Secret'] = this.cfAccessClientSecret;
      }

      // Bearer token as a second layer (validated by the Worker itself).
      if (this.workerToken) {
        headers['Authorization'] = `Bearer ${this.workerToken}`;
      }

      const res = await fetch(this.workerUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: `${this.fromName} <noreply@animesice.app>`,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => 'unknown');
        this.logger.error(`Mail worker returned ${res.status}: ${body}`);
        return false;
      }

      this.logger.log(`Email sent to ${payload.to} — ${payload.subject}`);
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${payload.to}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  sendVerificationCode(to: string, code: string): Promise<boolean> {
    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #6366f1;">AnimesIce</h2>
        <p>Seu código de verificação é:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; background: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px; margin: 16px 0;">
          ${code}
        </div>
        <p style="color: #6b7280; font-size: 14px;">
          Este código expira em 15 minutos. Se você não criou uma conta, ignore este email.
        </p>
      </div>
    `;
    const text = `Seu código de verificação AnimesIce: ${code}\n\nEste código expira em 15 minutos.`;

    return this.send({
      to,
      subject: 'Código de verificação — AnimesIce',
      html,
      text,
    });
  }
}
