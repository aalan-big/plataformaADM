/**
 * Roda antes de qualquer arquivo de teste (`--import` no script `test`).
 *
 * Instala o banco falso em `globalThis.prisma` ANTES de o `@startbig/database`
 * ser importado: o client de lá reaproveita o que já estiver nesse global e não
 * abre conexão nenhuma. Se este arquivo deixar de rodar primeiro, os testes
 * tentariam um Postgres de verdade — por isso o `DATABASE_URL` é apagado aqui:
 * melhor estourar do que encostar num banco por engano.
 */
import { Logger } from '@nestjs/common'
import { prismaFalso } from './prisma-falso'

delete process.env.DATABASE_URL
;(globalThis as any).prisma = prismaFalso

// O log do Nest é útil no servidor e ruído no teste. Quem quiser ver, comenta.
Logger.overrideLogger(false)
