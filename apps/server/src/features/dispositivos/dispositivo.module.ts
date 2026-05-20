/**
 * ============================================================================
 * NOME DO ARQUIVO: dispositivo.module.ts
 * MÓDULO: DISPOSITIVOS
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de DISPOSITIVOS. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 * 
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * - Declaração de Controllers.
 * - Importação de outros módulos necessários para este funcionar.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { DispositivoController } from './dispositivo.controller'
import { DispositivoService } from './dispositivo.service'
import { EmailModule } from '../../core/email/email.module'

@Module({
  imports:     [EmailModule],
  controllers: [DispositivoController],
  providers:   [DispositivoService],
})
export class DispositivoModule {}
