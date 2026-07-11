/**
 * ============================================================================
 * NOME DO ARQUIVO: main.ts
 * MÓDULO: INICIALIZAÇÃO DO SERVIDOR
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * É o Arquivo Principal que dá o "Start" (Boot) no Servidor Backend.
 * 
 * O QUE ELE CONTÉM:
 * - Configuração da porta do servidor (PORT env, padrão 3001).
 * - CORS restrito por allowlist (CORS_ORIGINS) em produção.
 * - Headers de segurança via Helmet.
 * - Aplicação de Interceptors e Pipes globais.
 * ============================================================================
 */
import dotenv from 'dotenv'
dotenv.config({ override: true })
import 'reflect-metadata'
import helmet from 'helmet'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './core/filters/http-exception.filter'
import { validarSegredosProducao } from './core/config/secrets'

async function bootstrap() {
  // Em produção, derruba o boot se faltar algum segredo obrigatório (JWT/Stripe)
  validarSegredosProducao()

  const app = await NestFactory.create(AppModule, { rawBody: true })

  // Headers de segurança (clickjacking, MIME sniffing, etc.)
  app.use(helmet())

  // CORS: em produção só as origens listadas em CORS_ORIGINS (separadas por vírgula)
  // podem chamar a API pelo navegador. Requisições server-to-server (proxy do Next,
  // webhook do Stripe) e do ERP (não-browser) não passam por CORS e não são afetadas.
  const ehProducao  = process.env.NODE_ENV === 'production'
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)

  app.enableCors({
    origin: ehProducao ? (corsOrigins.length ? corsOrigins : false) : true,
    credentials: true,
  })

  app.useGlobalFilters(new HttpExceptionFilter())

  const porta = Number(process.env.PORT) || 3001
  await app.listen(porta)
  console.log(`Server running on http://localhost:${porta} (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`)
}

bootstrap()