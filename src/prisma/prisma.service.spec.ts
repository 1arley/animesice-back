import { PrismaService } from '@/prisma/prisma.service';

describe('PrismaService', () => {
  it('should have onModuleInit method defined on prototype', () => {
    expect(typeof PrismaService.prototype.onModuleInit).toBe('function');
  });

  it('should have onModuleDestroy method defined on prototype', () => {
    expect(typeof PrismaService.prototype.onModuleDestroy).toBe('function');
  });

  it('should implement OnModuleInit and OnModuleDestroy interfaces', () => {
    // Verify the class has the required lifecycle hooks on its prototype
    const protoMethods = Object.getOwnPropertyNames(PrismaService.prototype);
    expect(protoMethods).toContain('onModuleInit');
    expect(protoMethods).toContain('onModuleDestroy');
  });
});
