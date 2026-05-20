/**
 * ============================================================================
 * NOME DO ARQUIVO: financeiro.module.ts
 * MÓDULO: FINANCEIRO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de FINANCEIRO. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 * 
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * - Declaração de Controllers.
 * - Importação de outros módulos necessários para este funcionar.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { FinanceiroController } from './financeiro.controller'
import { FinanceiroService } from './financeiro.service'
@Module({
  imports:     [],
  controllers: [FinanceiroController],
  providers:   [FinanceiroService],
  exports:     [FinanceiroService],
})
export class FinanceiroModule {}
