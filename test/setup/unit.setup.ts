import { Test } from '@nestjs/testing';
import { PrismaService } from '@/prisma/prisma.service';

beforeAll(async () => {
  console.log('Unit test setup started...');

  const moduleRef = await Test.createTestingModule({
    providers: [PrismaService],
  }).compile();

  const prismaService = moduleRef.get<PrismaService>(PrismaService);

  await prismaService.user.deleteMany({});

  console.log('Unit test setup completed');
});

afterAll(async () => {
  console.log('Unit test teardown started...');

  const moduleRef = await Test.createTestingModule({
    providers: [PrismaService],
  }).compile();

  const prismaService = moduleRef.get<PrismaService>(PrismaService);
  await prismaService.user.deleteMany({});

  await prismaService.$disconnect();

  console.log('Unit test teardown completed');
});
