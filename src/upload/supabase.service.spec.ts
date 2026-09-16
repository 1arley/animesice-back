import { ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '@/upload/supabase.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

const { createClient } = jest.requireMock('@supabase/supabase-js');

const fullConfig = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_BUCKET: 'videos',
};

describe('SupabaseService', () => {
  let storageFrom: {
    upload: jest.Mock;
    getPublicUrl: jest.Mock;
  };

  function makeService(configValues: Record<string, string> = {}) {
    const config = { get: jest.fn((key: string) => configValues[key]) };
    return new SupabaseService(config as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    storageFrom = {
      upload: jest.fn(),
      getPublicUrl: jest.fn(),
    };
    createClient.mockReturnValue({
      storage: { from: jest.fn(() => storageFrom) },
    });
  });

  it('desabilita cliente quando faltam variáveis de ambiente', async () => {
    const service = makeService();

    await expect(
      service.uploadVideo(Buffer.alloc(1), 'video/mp4', 'x.mp4'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('envia o vídeo e retorna a URL pública', async () => {
    const service = makeService(fullConfig);
    storageFrom.upload.mockResolvedValue({ error: null });
    storageFrom.getPublicUrl.mockReturnValue({
      data: {
        publicUrl:
          'https://abc.supabase.co/storage/v1/object/public/videos/vid.mp4',
      },
    });

    const result = await service.uploadVideo(
      Buffer.from('data'),
      'video/mp4',
      'ep1.mp4',
    );

    expect(storageFrom.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^videos\/.+\.mp4$/),
      Buffer.from('data'),
      { contentType: 'video/mp4', upsert: false },
    );
    expect(result.url).toBe(
      'https://abc.supabase.co/storage/v1/object/public/videos/vid.mp4',
    );
    expect(result.path).toMatch(/^videos\//);
  });

  it('preserva a extensão do arquivo original', async () => {
    const service = makeService(fullConfig);
    storageFrom.upload.mockResolvedValue({ error: null });
    storageFrom.getPublicUrl.mockReturnValue({
      data: {
        publicUrl:
          'https://abc.supabase.co/storage/v1/object/public/videos/v.ts',
      },
    });

    await service.uploadVideo(Buffer.from('d'), 'video/mp2t', 'ep1.ts');

    expect(storageFrom.upload).toHaveBeenCalledWith(
      expect.stringMatching(/\.ts$/),
      expect.anything(),
      expect.anything(),
    );
  });

  it('lança ForbiddenException quando o storage retorna erro', async () => {
    const service = makeService(fullConfig);
    storageFrom.upload.mockResolvedValue({ error: { message: 'quota' } });

    await expect(
      service.uploadVideo(Buffer.from('d'), 'video/mp4', 'x.mp4'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lança ForbiddenException quando não há URL pública', async () => {
    const service = makeService(fullConfig);
    storageFrom.upload.mockResolvedValue({ error: null });
    storageFrom.getPublicUrl.mockReturnValue({ data: null });

    await expect(
      service.uploadVideo(Buffer.from('d'), 'video/mp4', 'x.mp4'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
