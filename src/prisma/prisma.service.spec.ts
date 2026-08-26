import { PrismaService } from '@/prisma/prisma.service';

jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn(async () => undefined);
    $disconnect = jest.fn(async () => undefined);
    constructor(_opts?: unknown) {}
  }
  return { PrismaClient: MockPrismaClient };
});

describe('PrismaService', () => {
  const originalProvider = process.env.DATABASE_PROVIDER;
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.DATABASE_PROVIDER;
    } else {
      process.env.DATABASE_PROVIDER = originalProvider;
    }
    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
    jest.restoreAllMocks();
  });

  it('should instantiate with postgresql provider (default)', () => {
    delete process.env.DATABASE_PROVIDER;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    expect(() => new PrismaService()).not.toThrow();
  });

  it('should instantiate with explicit postgresql provider', () => {
    process.env.DATABASE_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    expect(() => new PrismaService()).not.toThrow();
  });

  it('should instantiate with sqlite provider', () => {
    process.env.DATABASE_PROVIDER = 'sqlite';
    process.env.DATABASE_URL = 'file:./test.db';
    expect(() => new PrismaService()).not.toThrow();
  });

  it('should have onModuleInit and onModuleDestroy defined', () => {
    expect(typeof PrismaService.prototype.onModuleInit).toBe('function');
    expect(typeof PrismaService.prototype.onModuleDestroy).toBe('function');
  });

  it('should call $connect on module init', async () => {
    process.env.DATABASE_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    const svc = new PrismaService();
    await svc.onModuleInit();
    expect(svc.$connect).toHaveBeenCalled();
  });

  it('should call $disconnect on module destroy', async () => {
    process.env.DATABASE_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    const svc = new PrismaService();
    await svc.onModuleDestroy();
    expect(svc.$disconnect).toHaveBeenCalled();
  });
});
