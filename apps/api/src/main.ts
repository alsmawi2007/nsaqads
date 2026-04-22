import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { AuditContextInterceptor } from './common/interceptors/audit-log.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;
  const prefix = config.get<string>('app.apiPrefix') ?? 'api/v1';

  // Security
  app.use(helmet());
  app.enableCors();

  // Global prefix
  app.setGlobalPrefix(prefix);

  // Global pipes — class-validator with whitelist strips unknown properties
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global filters and interceptors
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new AuditContextInterceptor(),
  );

  // Swagger — R8: first-class deliverable
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nsaq API')
    .setDescription('Nsaq AdTech Platform — Phase 1 Backend API')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('Auth', 'Authentication and session management')
    .addTag('Organizations', 'Organization and membership management')
    .addTag('Ad Accounts', 'Provider ad account connections')
    .addTag('Campaigns', 'Campaign and ad set management')
    .addTag('Optimizer', 'Optimizer rules, actions, and cycle management')
    .addTag('Alerts', 'Alert management')
    .addTag('Admin', 'System admin settings and controls')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(port);
  console.log(`Nsaq API running on http://localhost:${port}/${prefix}`);
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
}

bootstrap();
