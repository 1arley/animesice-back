import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/prisma/prisma.service';

let app: INestApplication;
let prismaService: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  prismaService = moduleRef.get<PrismaService>(PrismaService);

  // Clean up any existing data
  await prismaService.refreshToken.deleteMany();
  await prismaService.user.deleteMany();
});

afterAll(async () => {
  try {
    if (prismaService) {
      await prismaService.refreshToken.deleteMany();
      await prismaService.user.deleteMany();
    }

    if (app) {
      await app.close();
    }
  } finally {
    if (prismaService) {
      await prismaService.$disconnect();
    }
  }
});

export function getApp(): INestApplication {
  return app;
}

export function getPrismaService(): PrismaService {
  return prismaService;
}

export async function createTestUser(
  email: string = 'test@example.com',
  password: string = 'Test123!',
  name: string = 'Test User',
  role: string = 'USER',
) {
  return prismaService.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 1),
      name,
      role,
    },
  });
}
