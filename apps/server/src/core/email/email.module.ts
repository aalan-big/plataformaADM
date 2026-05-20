/**
 * ============================================================================
 * NOME DO ARQUIVO: email.module.ts
 * MÓDULO: CORE/GERAL
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de CORE/GERAL. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 * 
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * - Declaração de Controllers.
 * - Importação de outros módulos necessários para este funcionar.
 * ============================================================================
 */
import { Global, Module } from '@nestjs/common'
import { EmailService } from './email.service'

@Global()
@Module({
  providers: [EmailService],
  exports:   [EmailService],
})
export class EmailModule {}
