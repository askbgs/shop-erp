import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(helmet());
  app.enableCors({ origin: config.get<string>('CORS_ORIGINS')!.split(',').map((s) => s.trim()), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Shop ERP API')
    .setDescription('Cloud ERP for phone shops, computer shops and repair centers — Phase 1')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  const port = config.get<number>('PORT')!;
  await app.listen(port);
  Logger.log(`API on http://localhost:${port}/api/v1 — docs at /docs`, 'Bootstrap');
}

bootstrap();
