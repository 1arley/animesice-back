import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MetricsController } from '@/metrics/metrics.controller';
import { MetricsService } from '@/metrics/metrics.service';

describe('MetricsController', () => {
  let controller: MetricsController;

  const mockMetricsService = {
    snapshot: jest.fn(),
  };

  const savedToken = process.env.METRICS_TOKEN;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.METRICS_TOKEN = 'my-secret-token';
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [{ provide: MetricsService, useValue: mockMetricsService }],
    }).compile();

    controller = module.get<MetricsController>(MetricsController);
  });

  afterEach(() => {
    if (savedToken !== undefined) {
      process.env.METRICS_TOKEN = savedToken;
    } else {
      delete process.env.METRICS_TOKEN;
    }
  });

  it('retorna snapshot quando token é válido', () => {
    mockMetricsService.snapshot.mockReturnValue({
      cache: { hitsFresh: 10, hitRate: 50 },
    });

    const result = controller.snapshot('my-secret-token');
    expect(result).toEqual({ cache: { hitsFresh: 10, hitRate: 50 } });
  });

  it('lança UnauthorizedException quando token é inválido', async () => {
    expect(() => controller.snapshot('wrong-token')).toThrow(
      UnauthorizedException,
    );
  });

  it('lança UnauthorizedException quando token não é enviado', async () => {
    expect(() => controller.snapshot(undefined)).toThrow(UnauthorizedException);
  });

  it('lança NotFoundException quando METRICS_TOKEN não configurado', async () => {
    delete process.env.METRICS_TOKEN;
    expect(() => controller.snapshot('anything')).toThrow(NotFoundException);
  });
});
