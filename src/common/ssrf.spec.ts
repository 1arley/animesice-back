import { lookup } from 'dns/promises';
import { BadRequestException } from '@nestjs/common';
import { resolveSafeUrl } from '@/common/ssrf';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

describe('SSRF DNS pinning', () => {
  beforeEach(() => mockedLookup.mockReset());

  it('usa no connect apenas o IP público validado, mesmo após rebinding', async () => {
    mockedLookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);

    const resolution = await resolveSafeUrl('https://cdn.example/video.mp4');
    const connected = await new Promise<{ address: string; family: number }>(
      (resolve, reject) => {
        resolution.lookup('cdn.example', { family: 0, all: false }, ((
          error: Error | null,
          address: string,
          family: number,
        ) => {
          if (error) reject(error);
          else resolve({ address, family });
        }) as never);
      },
    );

    expect(connected).toEqual({ address: '8.8.8.8', family: 4 });
    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  it('bloqueia se qualquer resposta DNS for privada', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);
    await expect(
      resolveSafeUrl('https://cdn.example/video.mp4'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bloqueia IPv4 privado mapeado em IPv6 hexadecimal', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '::ffff:7f00:1', family: 6 },
    ]);
    await expect(
      resolveSafeUrl('https://cdn.example/video.mp4'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lookup pinado recusa hostname diferente do validado', async () => {
    mockedLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    const resolution = await resolveSafeUrl('https://cdn.example/video.mp4');

    await expect(
      new Promise((resolve, reject) => {
        resolution.lookup('internal.example', {}, (error) =>
          error ? reject(error) : resolve(undefined),
        );
      }),
    ).rejects.toThrow('hostname não validado');
  });
});
