/**
 * ============================================================================
 * NOME DO ARQUIVO: backup.module.ts
 * MÓDULO: BACKUP (ADMIN)
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de BACKUP do painel. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { BackupController } from './backup.controller'
import { BackupService } from './backup.service'

@Module({
  controllers: [BackupController],
  providers:   [BackupService],
})
export class BackupModule {}
