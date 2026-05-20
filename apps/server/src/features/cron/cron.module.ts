/**
 * ============================================================================
 * NOME DO ARQUIVO: cron.module.ts
 * MÓDULO: CRON
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de CRON. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 * 
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * - Declaração de Controllers.
 * - Importação de outros módulos necessários para este funcionar.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { CronService } from './cron.service'
import { EmailModule } from '../../core/email/email.module'

@Module({
  imports: [EmailModule],
  providers: [CronService],
})
export class CronModule {}
