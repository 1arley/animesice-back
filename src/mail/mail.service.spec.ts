import { Logger } from '@nestjs/common';
import { MailService } from '@/mail/mail.service';

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

describe('MailService', () => {
  function buildConfig(apiKey: string | null = null) {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return apiKey;
        if (key === 'MAIL_FROM_NAME') return 'MeuSite';
        if (key === 'MAIL_FROM_EMAIL') return 'noreply@meusite.com';
        return undefined;
      }),
    };
    return { configService };
  }

  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    mockSend.mockReset();
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('constructor', () => {
    it('deve desabilitar envio quando RESEND_API_KEY não está definida', () => {
      const { configService } = buildConfig(null);
      const svc = new MailService(configService as any);
      expect((svc as any).resend).toBeNull();
      expect((svc as any).fromName).toBe('MeuSite');
      expect(warnSpy).toHaveBeenCalledWith(
        'RESEND_API_KEY not set — email sending disabled',
      );
    });

    it('deve usar padrões quando MAIL_FROM_* não estão definidos', () => {
      const configService = {
        get: jest.fn(() => null),
      };
      const svc = new MailService(configService as any);
      expect((svc as any).fromName).toBe('AnimesIce');
      expect((svc as any).fromEmail).toBe('noreply@animesice.app');
    });
  });

  describe('send', () => {
    it('deve retornar false e não chamar Resend quando desabilitado', async () => {
      const { configService } = buildConfig(null);
      const svc = new MailService(configService as any);
      const result = await svc.send({
        to: 'a@b.com',
        subject: 'S',
        html: '<p>x</p>',
        text: 'x',
      });
      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('deve enviar email com sucesso e retornar true', async () => {
      const { configService } = buildConfig('key-123');
      const svc = new MailService(configService as any);
      mockSend.mockResolvedValue({ data: { id: 'em-1' }, error: null });
      const result = await svc.send({
        to: 'a@b.com',
        subject: 'Olá',
        html: '<p>x</p>',
        text: 'x',
      });
      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'MeuSite <noreply@meusite.com>',
          to: ['a@b.com'],
          subject: 'Olá',
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        'Email sent to a@b.com — Olá (id: em-1)',
      );
    });

    it('deve retornar false quando o Resend retorna erro', async () => {
      const { configService } = buildConfig('key-123');
      const svc = new MailService(configService as any);
      mockSend.mockResolvedValue({
        data: null,
        error: { name: 'E', message: 'fail' },
      });
      const result = await svc.send({
        to: 'a@b.com',
        subject: 'S',
        html: '',
        text: '',
      });
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        'Resend error sending to a@b.com: E — fail',
      );
    });

    it('deve retornar false quando o Resend lança exceção', async () => {
      const { configService } = buildConfig('key-123');
      const svc = new MailService(configService as any);
      mockSend.mockRejectedValue(new Error('network'));
      const result = await svc.send({
        to: 'a@b.com',
        subject: 'S',
        html: '',
        text: '',
      });
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to send email to a@b.com: network',
      );
    });
  });

  describe('sendVerificationCode', () => {
    it('deve enviar código com html escapado', async () => {
      const { configService } = buildConfig('key-123');
      const svc = new MailService(configService as any);
      mockSend.mockResolvedValue({ data: { id: 'em-1' }, error: null });
      const result = await svc.sendVerificationCode('a@b.com', '123<456');
      expect(result).toBe(true);
      const arg = mockSend.mock.calls[0][0];
      expect(arg.to).toEqual(['a@b.com']);
      expect(arg.subject).toContain('Código de verificação');
      expect(arg.html).toContain('123&lt;456');
      expect(arg.text).toContain('123<456');
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('deve enviar link de reset com URL escapada', async () => {
      const { configService } = buildConfig('key-123');
      const svc = new MailService(configService as any);
      mockSend.mockResolvedValue({ data: { id: 'em-1' }, error: null });
      const result = await svc.sendPasswordResetEmail(
        'a@b.com',
        'https://x.test/r?a=1&b=2',
      );
      expect(result).toBe(true);
      const arg = mockSend.mock.calls[0][0];
      expect(arg.subject).toContain('Redefinição de senha');
      expect(arg.html).toContain('https://x.test/r?a=1&amp;b=2');
      expect(arg.text).toContain('https://x.test/r?a=1&b=2');
    });
  });

  describe('sendEmailChangeConfirm', () => {
    it('deve enviar confirmação de troca de email', async () => {
      const { configService } = buildConfig('key-123');
      const svc = new MailService(configService as any);
      mockSend.mockResolvedValue({ data: { id: 'em-1' }, error: null });
      const result = await svc.sendEmailChangeConfirm(
        'novo@b.com',
        'https://x.test/confirm',
      );
      expect(result).toBe(true);
      const arg = mockSend.mock.calls[0][0];
      expect(arg.subject).toContain('Confirme seu novo email');
      expect(arg.html).toContain('novo@b.com');
      expect(arg.text).toContain('https://x.test/confirm');
    });
  });
});
