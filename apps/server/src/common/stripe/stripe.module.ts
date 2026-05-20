/**
 * ============================================================================
 * NOME DO ARQUIVO: stripe.module.ts
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
import { StripeService } from './stripe.service'

@Global()
@Module({
  providers: [StripeService],
  exports:   [StripeService],
})
export class StripeModule {}
