/**
 * ============================================================================
 * NOME DO ARQUIVO: asaas.module.ts
 * MÓDULO: COMMON/ASAAS
 * ============================================================================
 * Caixa de fios do cliente Asaas. Global, como o do Stripe, porque tanto a
 * renovação (que cria a cobrança) quanto o financeiro (que recebe o webhook)
 * precisam do mesmo cliente.
 * ============================================================================
 */
import { Global, Module } from '@nestjs/common'
import { AsaasService } from './asaas.service'

@Global()
@Module({
  providers: [AsaasService],
  exports:   [AsaasService],
})
export class AsaasModule {}
