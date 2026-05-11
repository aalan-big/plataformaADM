import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './core/filters/http-exception.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true })
  app.enableCors()
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(3001)
  console.log('Server running on http://localhost:3001')
}

bootstrap()