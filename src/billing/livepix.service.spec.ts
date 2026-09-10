import { ConfigService } from '@nestjs/config';
import { LivePixService } from './livepix.service';

describe('LivePixService', () => {
  it('cria bypass como pagamento, não como mensagem', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'token', expires_in: 3600 }),
        {
          status: 200,
        },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'token', expires_in: 3600 }),
        {
          status: 200,
        },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { reference: 'ref-1', redirectUrl: 'https://checkout' },
        }),
        { status: 201 },
      ),
    );

    const service = new LivePixService({
      get: (key: string) =>
        ({ LIVEPIX_CLIENT_ID: 'id', LIVEPIX_CLIENT_SECRET: 'secret' })[key],
    } as ConfigService);

    await expect(
      service.createBypassCharge('ignored', 299, 'https://app/gacha'),
    ).resolves.toEqual({
      reference: 'ref-1',
      checkoutUrl: 'https://checkout',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.livepix.gg/v2/payments',
    );

    fetchMock.mockRestore();
  });
});
