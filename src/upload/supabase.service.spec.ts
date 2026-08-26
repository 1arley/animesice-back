import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '@/upload/supabase.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn((args) => args),
  DeleteObjectCommand: jest.fn((args) => args),
}));

const { createClient } = jest.requireMock('@supabase/supabase-js');
const { S3Client } = jest.requireMock('@aws-sdk/client-s3');

const fullConfig = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_BUCKET: 'videos',
  SUPABASE_S3_ACCESS_KEY_ID: 'ak',
  SUPABASE_S3_SECRET_ACCESS_KEY: 'sk',
  SUPABASE_S3_REGION: 'sa-east-1',
  SUPABASE_AVATAR_BUCKET: 'users_icons',
};

describe('SupabaseService', () => {
  let sendMock: jest.Mock;
  let storageFrom: any;

  function makeService(configValues: Record<string, string> = {}) {
    const config = { get: jest.fn((key: string) => configValues[key]) };
    return new SupabaseService(config as any);
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
    sendMock = jest.fn().mockResolvedValue({});
    S3Client.mockReturnValue({ send: sendMock });
  });

  describe('configuração', () => {
    it('desabilita cliente quando faltam variáveis de ambiente', async () => {
      const service = makeService();

      await expect(
        service.uploadVideo(Buffer.alloc(1), 'video/mp4', 'x.mp4'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('desabilita S3 quando faltam access keys', async () => {
      const service = makeService({
        SUPABASE_URL: 'https://abc.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
        SUPABASE_BUCKET: 'videos',
      });

      await expect(
        service.uploadImage(
          Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
          'image/jpeg',
          'x.jpg',
          'u1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('uploadVideo', () => {
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

  describe('uploadImage', () => {
    it('rejeita mimetype não permitido', async () => {
      const service = makeService(fullConfig);

      await expect(
        service.uploadImage(Buffer.alloc(10), 'image/gif', 'x.gif', 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita imagem vazia', async () => {
      const service = makeService(fullConfig);

      await expect(
        service.uploadImage(Buffer.alloc(0), 'image/png', 'x.png', 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita imagem acima do limite de 50KB', async () => {
      const service = makeService(fullConfig);

      await expect(
        service.uploadImage(
          Buffer.alloc(50 * 1024 + 1),
          'image/png',
          'x.png',
          'u1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita arquivo com magic bytes inválidos', async () => {
      const service = makeService(fullConfig);

      await expect(
        service.uploadImage(
          Buffer.from('não é imagem'),
          'image/png',
          'x.png',
          'u1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('faz upload de JPEG válido via S3', async () => {
      const service = makeService(fullConfig);
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]);

      const result = await service.uploadImage(
        jpeg,
        'image/jpeg',
        'x.jpg',
        'u1',
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(result.path).toMatch(/^u1\/.+\.jpg$/);
      expect(result.url).toMatch(
        new RegExp(
          `^${fullConfig.SUPABASE_URL}/storage/v1/object/public/users_icons/`,
        ),
      );
      const command = sendMock.mock.calls[0][0];
      expect(command.Bucket).toBe('users_icons');
      expect(command.ContentType).toBe('image/jpeg');
    });

    it('normaliza image/jpg para image/jpeg', async () => {
      const service = makeService(fullConfig);
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]);

      await service.uploadImage(jpeg, 'image/jpg', 'x.jpg', 'u1');

      expect(sendMock.mock.calls[0][0].ContentType).toBe('image/jpeg');
    });

    it('faz upload de PNG válido via S3', async () => {
      const service = makeService(fullConfig);
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const result = await service.uploadImage(png, 'image/png', 'x.png', 'u1');

      expect(result.path).toMatch(/\.png$/);
      expect(sendMock).toHaveBeenCalled();
    });
  });

  describe('deleteAvatarImage', () => {
    it('não faz nada quando a URL não pertence ao bucket de avatares', async () => {
      const service = makeService(fullConfig);

      await service.deleteAvatarImage('https://outro.com/x.png');

      expect(sendMock).not.toHaveBeenCalled();
    });

    it('não faz nada quando não há S3 configurado', async () => {
      const service = makeService();

      await service.deleteAvatarImage(
        'https://abc.supabase.co/storage/v1/object/public/users_icons/a.png',
      );

      expect(sendMock).not.toHaveBeenCalled();
    });

    it('não faz nada quando a URL é vazia', async () => {
      const service = makeService(fullConfig);

      await service.deleteAvatarImage('');

      expect(sendMock).not.toHaveBeenCalled();
    });

    it('remove objeto do S3 com a chave correta', async () => {
      const service = makeService(fullConfig);
      const url =
        'https://abc.supabase.co/storage/v1/object/public/users_icons/u1/avatar.png';

      await service.deleteAvatarImage(url);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const command = sendMock.mock.calls[0][0];
      expect(command.Bucket).toBe('users_icons');
      expect(command.Key).toBe('u1/avatar.png');
    });

    it('ignora falha silenciosamente', async () => {
      const service = makeService(fullConfig);
      sendMock.mockRejectedValue(new Error('boom'));
      const url =
        'https://abc.supabase.co/storage/v1/object/public/users_icons/u1/x.png';

      await expect(service.deleteAvatarImage(url)).resolves.toBeUndefined();
    });
  });
});
