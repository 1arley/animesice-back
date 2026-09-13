import { ConfigService } from '@nestjs/config';
import { LivePixService } from './livepix.service';

describe('LivePixService', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [[], false],
    [[{ reference: 'ref', amount: 299, currency: 'BRL' }], true],
    [[{ reference: 'other', amount: 299, currency: 'BRL' }], false],
    [[{ reference: 'ref', amount: 298, currency: 'BRL' }], false],
    [[{ reference: 'ref', amount: 299, currency: 'BNB' }], false],
    [[{ reference: 'ref', amount: 299 }], false],
  ])('valida pagamento recebido %j', async (payments, expected) => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'token', expires_in: 3600 }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: payments })));
    const service = new LivePixService({
      get: () => 'configured',
    } as unknown as ConfigService);

    await expect(service.isPaid('ref', 299)).resolves.toBe(expected);
    const url = fetchMock.mock.calls[1]?.[0] as URL;
    expect(url.pathname).toBe('/v2/payments');
    expect(url.searchParams.get('reference')).toBe('ref');
    expect(url.searchParams.get('currency')).toBe('BRL');
  });

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
