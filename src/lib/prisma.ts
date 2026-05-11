import { PrismaClient } from '@prisma/client'
import type { PrismaPg as PrismaPgType } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// require() em vez de import — @prisma/adapter-pg tem exportações CJS e ESM.
// O caminho ESM do Turbopack usa um ID com hash que o Node.js não consegue resolver.
// Usar require() força o caminho CJS, que funciona corretamente.
const { PrismaPg } = require('@prisma/adapter-pg') as { PrismaPg: typeof PrismaPgType }

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
