import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StreamingController } from '@/streaming/streaming.controller';
import { StreamingService } from '@/streaming/streaming.service';
import { ConfigService } from '@nestjs/config';

describe('StreamingController', () => {
  let controller: StreamingController;

  const configService = {
    get: jest.fn((key: string): string | undefined => {
      if (key === 'PUBLIC_BACKEND_URL') return 'https://api.animesice.com';
      if (key === 'TRUST_PROXY') return 'true';
      return undefined;
    }),
  };

  const mockStreamingService = {
    getSource: jest.fn(),
    getSourceAsync: jest.fn(),
    getJobStatus: jest.fn(),
    generateToken: jest.fn(),
    proxyVideo: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string): string | undefined => {
      if (key === 'PUBLIC_BACKEND_URL') return 'https://api.animesice.com';
      if (key === 'TRUST_PROXY') return 'true';
      return undefined;
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StreamingController],
      providers: [
        { provide: StreamingService, useValue: mockStreamingService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<StreamingController>(StreamingController);
  });

  describe('getSource', () => {
    function makeRes() {
      return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
    }

    it('retorna source do episódio', async () => {
      mockStreamingService.getSource.mockResolvedValue({
        animeSlug: 'solo',
        episodeNumber: 1,
        src: 'https://api.animesice.com/api/embed/media?url=...',
      });

      const req = {
        headers: { host: 'api.animesice.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();

      await controller.getSource(
        'solo',
        '1',
        undefined,
        undefined,
        undefined,
        req,
        res,
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ animeSlug: 'solo' }),
      );
      expect(mockStreamingService.getSource).toHaveBeenCalledWith(
        'solo',
        1,
        'https://api.animesice.com',
        1,
        false,
      );
    });

    it('lança NotFoundException quando anime ou episode ausente', async () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await expect(
        controller.getSource(
          '',
          'abc',
          undefined,
          undefined,
          undefined,
          req,
          res,
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        controller.getSource(
          'solo',
          'abc',
          undefined,
          undefined,
          undefined,
          req,
          res,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('passa forceRefresh=true quando refresh=1', async () => {
      mockStreamingService.getSource.mockResolvedValue({
        animeSlug: 'solo',
        episodeNumber: 1,
        src: '...',
      });
      const req = {
        headers: { host: 'api.animesice.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await controller.getSource(
        'solo',
        '1',
        '1',
        undefined,
        undefined,
        req,
        res,
      );
      expect(mockStreamingService.getSource).toHaveBeenCalledWith(
        'solo',
        1,
        'https://api.animesice.com',
        1,
        true,
      );
    });

    it('passa forceRefresh=true quando refresh=true', async () => {
      mockStreamingService.getSource.mockResolvedValue({
        animeSlug: 'solo',
        episodeNumber: 1,
        src: '...',
      });
      const req = {
        headers: { host: 'api.animesice.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await controller.getSource(
        'solo',
        '1',
        'true',
        undefined,
        undefined,
        req,
        res,
      );
      expect(mockStreamingService.getSource).toHaveBeenCalledWith(
        'solo',
        1,
        'https://api.animesice.com',
        1,
        true,
      );
    });

    it('usa x-forwarded-host quando trustProxy e sem PUBLIC_BACKEND_URL', async () => {
      configService.get.mockImplementation(
        (key: string): string | undefined => {
          if (key === 'PUBLIC_BACKEND_HOSTS') return 'api.animesice.com';
          if (key === 'TRUST_PROXY') return 'true';
          return undefined;
        },
      );
      mockStreamingService.getSource.mockResolvedValue({
        animeSlug: 'solo',
        episodeNumber: 1,
        src: '...',
      });
      const req = {
        headers: {
          'x-forwarded-host': 'api.animesice.com',
          'x-forwarded-proto': 'https',
        },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await controller.getSource(
        'solo',
        '1',
        undefined,
        undefined,
        undefined,
        req,
        res,
      );
      expect(mockStreamingService.getSource).toHaveBeenCalledWith(
        'solo',
        1,
        'https://api.animesice.com',
        1,
        false,
      );
    });

    it('usa host header direto quando trustProxy desativado', async () => {
      configService.get.mockImplementation(
        (key: string): string | undefined => {
          if (key === 'PUBLIC_BACKEND_HOSTS') return 'api.animesice.com';
          if (key === 'TRUST_PROXY') return 'false';
          return undefined;
        },
      );
      mockStreamingService.getSource.mockResolvedValue({
        animeSlug: 'solo',
        episodeNumber: 1,
        src: '...',
      });
      const req = {
        headers: { host: 'api.animesice.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await controller.getSource(
        'solo',
        '1',
        undefined,
        undefined,
        undefined,
        req,
        res,
      );
      expect(mockStreamingService.getSource).toHaveBeenCalledWith(
        'solo',
        1,
        'https://api.animesice.com',
        1,
        false,
      );
    });

    it('usa req.protocol em desenvolvimento quando não há allowlist configurada', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      configService.get.mockImplementation(
        (key: string): string | undefined => {
          if (key === 'TRUST_PROXY') return 'false';
          return undefined;
        },
      );
      mockStreamingService.getSource.mockResolvedValue({
        animeSlug: 'solo',
        episodeNumber: 1,
        src: '...',
      });
      const req = {
        headers: { host: 'api.animesice.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'http',
      } as any;
      const res = makeRes();
      await controller.getSource(
        'solo',
        '1',
        undefined,
        undefined,
        undefined,
        req,
        res,
      );
      expect(mockStreamingService.getSource).toHaveBeenCalledWith(
        'solo',
        1,
        'http://api.animesice.com',
        1,
        false,
      );
      process.env.NODE_ENV = origEnv;
    });

    it('cai para localhost sem host válido fora de produção', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      configService.get.mockImplementation(
        (key: string): string | undefined => {
          if (key === 'TRUST_PROXY') return 'false';
          return undefined;
        },
      );
      mockStreamingService.getSource.mockResolvedValue({
        animeSlug: 'solo',
        episodeNumber: 1,
        src: '...',
      });
      const req = {
        headers: {},
        socket: { remoteAddress: '::1' },
        protocol: 'http',
      } as any;
      const res = makeRes();
      await controller.getSource(
        'solo',
        '1',
        undefined,
        undefined,
        undefined,
        req,
        res,
      );
      expect(mockStreamingService.getSource).toHaveBeenCalledWith(
        'solo',
        1,
        'http://localhost',
        1,
        false,
      );
      process.env.NODE_ENV = origEnv;
    });

    it('lança ForbiddenException em produção sem PUBLIC_BACKEND_URL/HOSTS', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      configService.get.mockImplementation(
        (key: string): string | undefined => {
          if (key === 'TRUST_PROXY') return 'false';
          return undefined;
        },
      );
      const req = {
        headers: { host: 'api.animesice.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await expect(
        controller.getSource(
          'solo',
          '1',
          undefined,
          undefined,
          undefined,
          req,
          res,
        ),
      ).rejects.toThrow(ForbiddenException);
      process.env.NODE_ENV = origEnv;
    });

    it('lança ForbiddenException em produção quando host não está na allowlist', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      configService.get.mockImplementation(
        (key: string): string | undefined => {
          if (key === 'PUBLIC_BACKEND_HOSTS') return 'api.animesice.com';
          if (key === 'TRUST_PROXY') return 'false';
          return undefined;
        },
      );
      const req = {
        headers: { host: 'evil.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await expect(
        controller.getSource(
          'solo',
          '1',
          undefined,
          undefined,
          undefined,
          req,
          res,
        ),
      ).rejects.toThrow(ForbiddenException);
      process.env.NODE_ENV = origEnv;
    });

    it('retorna 202 com jobId quando async=1 e extração é necessária', async () => {
      mockStreamingService.getSourceAsync.mockResolvedValue({
        jobId: 'ext:test:1',
      });
      const req = {
        headers: { host: 'api.animesice.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await controller.getSource(
        'solo',
        '1',
        undefined,
        '1',
        undefined,
        req,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'ext:test:1', status: 'pending' }),
      );
    });

    it('retorna source normalmente quando async=1 mas vídeo já existe', async () => {
      mockStreamingService.getSourceAsync.mockResolvedValue(null);
      mockStreamingService.getSource.mockResolvedValue({
        animeSlug: 'solo',
        episodeNumber: 1,
        src: 'https://api.animesice.com/api/embed/media?url=...',
      });
      const req = {
        headers: { host: 'api.animesice.com' },
        socket: { remoteAddress: '::1' },
        protocol: 'https',
      } as any;
      const res = makeRes();
      await controller.getSource(
        'solo',
        '1',
        undefined,
        '1',
        undefined,
        req,
        res,
      );
      expect(mockStreamingService.getSource).toHaveBeenCalled();
    });
  });

  describe('getToken', () => {
    it('chama generateToken com IP do cliente', async () => {
      mockStreamingService.generateToken.mockResolvedValue({
        url: 'https://cdn/v.mp4',
        token: 'xxx',
        expires: 1234567890,
        ip: '93.184.216.34',
      });

      const req = {
        headers: { 'x-forwarded-for': '93.184.216.34, 10.0.0.1' },
        socket: { remoteAddress: '::1' },
      } as any;

      const result = await controller.getToken('solo', '1', req);
      expect(result.token).toBe('xxx');
      expect(mockStreamingService.generateToken).toHaveBeenCalledWith(
        '1',
        'solo',
        '93.184.216.34',
      );
    });

    it('usa remoteAddress quando x-forwarded-for não existe', async () => {
      mockStreamingService.generateToken.mockResolvedValue({
        url: 'https://cdn/v.mp4',
        token: 'yyy',
        expires: 1234567890,
        ip: '127.0.0.1',
      });

      const req = {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      await controller.getToken('solo', '1', req);
      expect(mockStreamingService.generateToken).toHaveBeenCalledWith(
        '1',
        'solo',
        '127.0.0.1',
      );
    });

    it('usa remoteAddress quando trustProxy desativado', async () => {
      configService.get.mockImplementation(
        (key: string): string | undefined => {
          if (key === 'TRUST_PROXY') return 'false';
          return undefined;
        },
      );
      mockStreamingService.generateToken.mockResolvedValue({
        url: 'https://cdn/v.mp4',
        token: 'zzz',
        expires: 1234567890,
        ip: '127.0.0.1',
      });

      const req = {
        headers: { 'x-forwarded-for': '93.184.216.34' },
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      await controller.getToken('solo', '1', req);
      expect(mockStreamingService.generateToken).toHaveBeenCalledWith(
        '1',
        'solo',
        '127.0.0.1',
      );
    });

    it('usa 0.0.0.0 como fallback sem remoteAddress', async () => {
      mockStreamingService.generateToken.mockResolvedValue({
        url: 'https://cdn/v.mp4',
        token: 'q',
        expires: 1234567890,
        ip: '0.0.0.0',
      });

      const req = {
        headers: {},
        socket: {},
      } as any;

      await controller.getToken('solo', '1', req);
      expect(mockStreamingService.generateToken).toHaveBeenCalledWith(
        '1',
        'solo',
        '0.0.0.0',
      );
    });
  });

  describe('proxyVideo', () => {
    it('chama res.end quando status é 206 mas não há body', async () => {
      mockStreamingService.proxyVideo.mockResolvedValue({
        status: 206,
        headers: new Map([
          ['content-type', 'video/mp4'],
          ['content-range', 'bytes 0-99/100'],
        ]) as any,
        body: null,
      });

      const res = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        headersSent: false,
        destroy: jest.fn(),
        end: jest.fn(),
      } as any;

      const req = {
        headers: { range: 'bytes=0-99' },
        socket: { remoteAddress: '::1' },
      } as any;

      await controller.proxyVideo(
        'token123',
        '999999999999',
        'ignored',
        req,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(206);
      expect(res.setHeader).toHaveBeenCalledWith('content-type', 'video/mp4');
      expect(res.setHeader).toHaveBeenCalledWith(
        'content-range',
        'bytes 0-99/100',
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('chama res.end quando status não é 200/206', async () => {
      mockStreamingService.proxyVideo.mockResolvedValue({
        status: 302,
        headers: new Map() as any,
        body: null,
      });

      const res = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        headersSent: false,
        destroy: jest.fn(),
        end: jest.fn(),
      } as any;

      const req = {
        headers: { range: 'bytes=0-99' },
        socket: { remoteAddress: '::1' },
      } as any;

      await controller.proxyVideo(
        'token123',
        '999999999999',
        'ignored',
        req,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(302);
      expect(res.end).toHaveBeenCalled();
    });

    it('retorna 403 quando streamingService lança ForbiddenException', async () => {
      mockStreamingService.proxyVideo.mockRejectedValue(
        new ForbiddenException('Token expirado'),
      );

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
      const req = {
        headers: { range: 'bytes=0-99' },
        socket: { remoteAddress: '::1' },
      } as any;

      await controller.proxyVideo(
        'token123',
        '999999999999',
        'ignored',
        req,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('retorna 404 quando streamingService lança NotFoundException', async () => {
      mockStreamingService.proxyVideo.mockRejectedValue(
        new NotFoundException('Vídeo não encontrado'),
      );

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
      const req = {
        headers: { range: 'bytes=0-99' },
        socket: { remoteAddress: '::1' },
      } as any;

      await controller.proxyVideo(
        'token123',
        '999999999999',
        'ignored',
        req,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('relança erro genérico do streamingService', async () => {
      mockStreamingService.proxyVideo.mockRejectedValue(
        new Error('erro inesperado'),
      );

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
      const req = {
        headers: { range: 'bytes=0-99' },
        socket: { remoteAddress: '::1' },
      } as any;

      await expect(
        controller.proxyVideo('token123', '999999999999', 'i', req, res),
      ).rejects.toThrow('erro inesperado');
    });

    it('lança NotFoundException quando token/expires ausentes', async () => {
      const res = { status: jest.fn(), json: jest.fn() } as any;
      const req = {
        headers: {},
        socket: { remoteAddress: '::1' },
      } as any;
      await expect(controller.proxyVideo('', '', '', req, res)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
