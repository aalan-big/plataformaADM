import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const connectionString = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '')
  .replace(/[?&]pgbouncer=true/, '')

const pool = new Pool({
  connectionString,
  max:                         5,
  idleTimeoutMillis:           20000,
  connectionTimeoutMillis:     15000,
  keepAlive:                   true,
  keepAliveInitialDelayMillis: 10000,
  ssl: { rejectUnauthorized: false },
})

const adapter = new PrismaPg(pool)

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
