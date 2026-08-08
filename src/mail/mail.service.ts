import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null = null;
  private readonly fromName: string;
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.fromName =
      this.configService.get<string>('MAIL_FROM_NAME') || 'AnimesIce';
    this.fromEmail =
      this.configService.get<string>('MAIL_FROM_EMAIL') ||
      'noreply@animesice.app';

    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn('RESEND_API_KEY not set — email sending disabled');
    }
  }

  async send(payload: MailPayload): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY not configured — skipping email to ${payload.to}`,
      );
      return false;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      });

      if (error) {
        this.logger.error(
          `Resend error sending to ${payload.to}: ${error.name} — ${error.message}`,
        );
        return false;
      }

      this.logger.log(
        `Email sent to ${payload.to} — ${payload.subject} (id: ${data?.id})`,
      );
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
