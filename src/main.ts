import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from '@/app.module';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  assertSecrets();

  app.use(cookieParser());

  // Global prefix
  const apiPrefix = process.env.API_PREFIX || 'api';
  app.setGlobalPrefix(apiPrefix);

  // CORS: com cookie httpOnly, origins devem ser explícitas. Sem CORS_ORIGIN
  // configurado, cross-origin fica desabilitado (origin: false).
  const corsOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: process.env.CORS_CREDENTIALS === 'true',
  });

  // Global filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('AnimesIce API')
    .setDescription(
      'AnimesIce backend - API de catálogo de animes com streaming, auth e Prisma',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('health', 'Endpoints de health check')
    .addTag('auth', 'Endpoints de autenticação')
    .addTag('user', 'Gerenciamento de usuários')
    .addTag('anime', 'Catálogo de animes')
    .addTag('genre', 'Gêneros de animes')
    .addTag('episode', 'Episódios de animes')
    .addTag('streaming', 'Streaming de vídeos com token')
    .addTag('comment', 'Comentários de usuários')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const swaggerPath = process.env.SWAGGER_PATH || 'api/docs';
  SwaggerModule.setup(swaggerPath, app, document, {
    customSiteTitle: 'AnimesIce API Docs',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: '.swagger-ui .topbar { display: none }',
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(
    `\n🚀 Application is running on: http://localhost:${port}/${apiPrefix}`,
  );
  console.log(
    `📚 Swagger documentation: http://localhost:${port}/${swaggerPath}\n`,
  );
}

const PLACEHOLDER_SECRETS = new Set([
  'your-access-secret',
  'your-refresh-secret',
]);

function assertSecrets(): void {
  const secrets = [
    ['JWT_ACCESS_SECRET', process.env.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET],
  ] as const;

  for (const [name, value] of secrets) {
    const insecure =
      !value || value.length < 32 || PLACEHOLDER_SECRETS.has(value);
    if (!insecure) continue;

    const message = `[env] ${name} ausente, curto demais ou placeholder. Gere um secret forte (>= 32 chars).`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message);
    }
    console.warn(message);
  }
}

void bootstrap();
