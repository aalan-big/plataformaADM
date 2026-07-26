/**
 * ============================================================================
 * NOME DO ARQUIVO: simular-limpeza-backup.ts
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Roda as duas rotinas de limpeza de backup em modo SIMULAÇÃO — a retenção de
 * 90 dias e a varredura de órfãos. Nada é apagado: elas percorrem exatamente o
 * mesmo caminho de código do cron e só imprimem a decisão que tomariam.
 *
 * POR QUE ISSO EXISTE:
 * As duas apagam arquivo e rodam sozinhas, sem ninguém mandar. Colocar em
 * produção uma rotina destrutiva que nunca foi executada é apostar que o código
 * está certo — este script troca a aposta por uma conferência.
 *
 * COMO RODAR (na VPS, onde as credenciais do bucket estão):
 *   npm run backup:simular
 * ============================================================================
 */
import { CronService } from '../apps/server/src/features/cron/cron.service'
import { EmailService } from '../apps/server/src/core/email/email.service'
import { StorageService } from '../apps/server/src/common/storage/storage.service'
import { prisma } from '@startbig/database'

async function main() {
  const storage = new StorageService()

  console.log('\n=== Simulação de limpeza de backup ===\n')

  if (!storage.configurado) {
    console.log('\x1b[31mBACKUP_S3_* não configuradas neste .env — nada a simular.\x1b[0m\n')
    process.exit(1)
  }

  console.log(`bucket: ${process.env.BACKUP_S3_BUCKET}`)
  console.log('\x1b[33mNADA SERÁ APAGADO. Isto é uma simulação.\x1b[0m\n')

  const cron = new CronService(new EmailService(), storage)

  console.log('--- Retenção (licença inativa há mais de 90 dias) ---')
  await cron.aplicarRetencaoDeBackups({ simular: true })

  console.log('\n--- Varredura de órfãos (pasta sem licença no banco) ---')
  await cron.removerBackupsOrfaos({ simular: true })

  console.log('\n\x1b[32mFim da simulação. Nenhum arquivo foi removido.\x1b[0m')
  console.log('Confira acima se alguma linha REMOVERIA algo que deveria ficar.\n')

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error('\n\x1b[31mErro na simulação:\x1b[0m', e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
