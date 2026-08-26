import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EmbedController } from '@/embed/embed.controller';
import { EmbedService } from '@/embed/embed.service';
import { ScrapeService } from '@/embed/scrape/scrape.service';

describe('EmbedController', () => {
  let controller: EmbedController;

  const embedService = {
    proxyHtml: jest.fn(),
    proxyMedia: jest.fn(),
  };

  const scrapeService = {
    scrapeEpisodeVideo: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmbedController],
      providers: [
        { provide: EmbedService, useValue: embedService },
        { provide: ScrapeService, useValue: scrapeService },
      ],
    }).compile();

    controller = module.get<EmbedController>(EmbedController);
  });

  describe('proxy', () => {
    it('retorna 400 quando url está ausente', async () => {
      const res = { status: jest.fn(), setHeader: jest.fn(), send: jest.fn() };
      await expect(controller.proxy({} as any, res as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('serve o HTML e remove headers proibidos de iframe', async () => {
      embedService.proxyHtml.mockResolvedValue({
        status: 200,
        headers: {
          'content-type': 'text/html',
          'x-frame-options': 'DENY',
          'content-security-policy': 'default-src none',
          'x-secret': '1',
          'cache-control': 'public, max-age=60',
        },
        body: '<html>proxy</html>',
      });

      const res = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        removeHeader: jest.fn(),
        send: jest.fn(),
      };

      await controller.proxy({ url: 'https://animefire.io/x' }, res as any);

      expect(embedService.proxyHtml).toHaveBeenCalledWith(
        'https://animefire.io/x',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      // Headers proibidos não são repassados
      expect(res.setHeader).not.toHaveBeenCalledWith('x-frame-options', 'DENY');
      expect(res.setHeader).not.toHaveBeenCalledWith(
        'content-security-policy',
        'default-src none',
      );
      // Defesa em profundidade remove qualquer header de frame
      expect(res.removeHeader).toHaveBeenCalledWith('x-frame-options');
      expect(res.removeHeader).toHaveBeenCalledWith('content-security-policy');
      // CSP de sandbox do proxy + nosniff
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        'sandbox allow-scripts allow-popups allow-modals',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.send).toHaveBeenCalledWith('<html>proxy</html>');
    });

    it('usa content-type padrão quando o upstream não informa', async () => {
      embedService.proxyHtml.mockResolvedValue({
        status: 200,
        headers: {},
        body: '<html>proxy</html>',
      });

      const res = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        removeHeader: jest.fn(),
        send: jest.fn(),
      };

      await controller.proxy({ url: 'https://animefire.io/x' }, res as any);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/html; charset=utf-8',
      );
    });
  });

  describe('media', () => {
    it('retorna 400 quando url está ausente', async () => {
      const res = { status: jest.fn(), setHeader: jest.fn() };
      await expect(controller.media({} as any, {}, res as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('define status e headers da mídia antes do streaming', async () => {
      embedService.proxyMedia.mockResolvedValue({
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-11/12',
          'x-vazio': '',
          'x-nulo': null,
        },
        body: {},
      });
      const res = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        send: jest.fn(),
        destroy: jest.fn(),
        headersSent: false,
      };
      await expect(
        controller.media(
          { url: 'https://cdn/v.mp4', referer: 'https://animefire.io/' } as any,
          { 'user-agent': 'Mozilla' } as any,
          res as any,
        ),
      ).rejects.toThrow(/dynamic import/);
      expect(embedService.proxyMedia).toHaveBeenCalledWith(
        'https://cdn/v.mp4',
        { 'user-agent': 'Mozilla' },
        'https://animefire.io/',
      );
      expect(res.status).toHaveBeenCalledWith(206);
      expect(res.setHeader).toHaveBeenCalledWith('content-type', 'video/mp4');
      expect(res.setHeader).toHaveBeenCalledWith(
        'content-range',
        'bytes 0-11/12',
      );
      expect(res.setHeader).not.toHaveBeenCalledWith('x-vazio', '');
      expect(res.setHeader).not.toHaveBeenCalledWith('x-nulo', null);
    });
  });

  describe('scrape', () => {
    it('retorna 400 quando url está ausente', async () => {
      await expect(controller.scrape({} as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('delega para scrapeService.scrapeEpisodeVideo com source', async () => {
      scrapeService.scrapeEpisodeVideo.mockResolvedValue({
        videos: ['https://cdn/v.mp4'],
        iframes: [],
        cloudflare: false,
      });

      const result = await controller.scrape({
        url: 'https://animefire.io/animes/x/1',
        source: 'animefire',
      } as any);

      expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledWith(
        'https://animefire.io/animes/x/1',
        'animefire',
      );
      expect(result.videos).toEqual(['https://cdn/v.mp4']);
    });

    it('delega sem source quando não informado', async () => {
      scrapeService.scrapeEpisodeVideo.mockResolvedValue({
        videos: [],
        iframes: [],
        cloudflare: false,
      });

      await controller.scrape({
        url: 'https://animefire.io/animes/x/1',
      });
      expect(scrapeService.scrapeEpisodeVideo).toHaveBeenCalledWith(
        'https://animefire.io/animes/x/1',
        undefined,
      );
    });
  });
});
