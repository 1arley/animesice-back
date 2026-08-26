import { UnauthorizedException } from '@nestjs/common';
import { TurnstileService } from '@/auth/turnstile/turnstile.service';

describe('TurnstileService', () => {
  let service: TurnstileService;
  let fetchMock: jest.SpyInstance;
  const originalSecret = process.env.TURNSTILE_SECRET;

  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET;
    service = new TurnstileService();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSecret !== undefined) {
      process.env.TURNSTILE_SECRET = originalSecret;
    } else {
      delete process.env.TURNSTILE_SECRET;
    }
  });

  it('passa silenciosamente quando não há segredo configurado', async () => {
    await expect(service.verify('token')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lança UnauthorizedException quando o token está ausente', async () => {
    process.env.TURNSTILE_SECRET = 'secret';

    await expect(service.verify(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lança UnauthorizedException quando o token é vazio', async () => {
    process.env.TURNSTILE_SECRET = 'secret';

    await expect(service.verify('')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('valida token com sucesso quando success é true', async () => {
    process.env.TURNSTILE_SECRET = 'secret';
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true }),
    } as any);

    await expect(service.verify('token')).resolves.toBeUndefined();
  });

  it('lança UnauthorizedException quando success é false', async () => {
    process.env.TURNSTILE_SECRET = 'secret';
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest
        .fn()
        .mockResolvedValue({ success: false, error_codes: ['bad-input'] }),
    } as any);

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lança UnauthorizedException quando a resposta HTTP não é ok', async () => {
    process.env.TURNSTILE_SECRET = 'secret';
    fetchMock.mockResolvedValue({ ok: false, status: 400 } as any);

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lança UnauthorizedException quando o fetch falha', async () => {
    process.env.TURNSTILE_SECRET = 'secret';
    fetchMock.mockRejectedValue(new Error('network'));

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('envia secret e response como body URL-encoded', async () => {
    process.env.TURNSTILE_SECRET = 'my-secret';
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true }),
    } as any);

    await service.verify('my-token');

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('secret')).toBe('my-secret');
    expect(body.get('response')).toBe('my-token');
  });

  it('aceita um segredo explícito em vez do env', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true }),
    } as any);

    await service.verify('token', 'explicit-secret');

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('secret')).toBe('explicit-secret');
  });

  it('envia para o endpoint correto do Cloudflare', async () => {
    process.env.TURNSTILE_SECRET = 'secret';
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true }),
    } as any);

    await service.verify('token');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
