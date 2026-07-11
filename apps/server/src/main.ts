/**
 * ============================================================================
 * NOME DO ARQUIVO: main.ts
 * MÓDULO: INICIALIZAÇÃO DO SERVIDOR
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * É o Arquivo Principal que dá o "Start" (Boot) no Servidor Backend.
 * 
 * O QUE ELE CONTÉM:
 * - Configuração da porta do servidor (3001).
 * - Habilitação do CORS (para permitir que o frontend converse com a API).
 * - Aplicação de Interceptors e Pipes globais.
 * ============================================================================
 */
import dotenv from 'dotenv'
dotenv.config({ override: true })
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './core/filters/http-exception.filter'
import { validarSegredosProducao } from './core/config/secrets'

async function bootstrap() {
  // Em produção, derruba o boot se faltar algum segredo obrigatório (JWT/Stripe)
  validarSegredosProducao()

  const app = await NestFactory.create(AppModule, { rawBody: true })
  app.enableCors()
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(3001)
  console.log('Server running on http://localhost:3001')
}

bootstrap()