/**
 * ============================================================================
 * NOME DO ARQUIVO: renovacao.module.ts
 * MÓDULO: RENOVAÇÃO
 * ============================================================================
 * Caixa de fios da renovação de assinatura pelo ERP local (PIX e cartão).
 *
 * Importa o FinanceiroModule em vez de reimplementar cobrança: o cartão continua
 * passando exatamente pelo mesmo `gerarCobranca` que o painel e o site usam, e a
 * confirmação do PIX cai no mesmo funil de renovação do Stripe. Uma segunda
 * implementação de "o dinheiro entrou" seria a forma mais rápida de fazer os
 * dois caminhos divergirem.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { RenovacaoController } from './renovacao.controller'
import { RenovacaoService } from './renovacao.service'
import { RenovacaoCredencialService } from './renovacao-credencial.service'
import { FinanceiroModule } from '../financeiro/financeiro.module'

@Module({
  imports:     [FinanceiroModule],
  controllers: [RenovacaoController],
  providers:   [RenovacaoService, RenovacaoCredencialService],
  exports:     [RenovacaoCredencialService],
})
export class RenovacaoModule {}
