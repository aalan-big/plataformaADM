/**
 * ============================================================================
 * NOME DO ARQUIVO: notificacao.module.ts
 * MÓDULO: COMMON/NOTIFICAÇÃO
 * ============================================================================
 * Caixa de fios do push. Global porque o financeiro precisa avisar quando o
 * dinheiro entra, e o financeiro é quem sabe disso primeiro.
 * ============================================================================
 */
import { Global, Module } from '@nestjs/common'
import { NotificacaoService } from './notificacao.service'
import { NotificacaoController } from './notificacao.controller'

@Global()
@Module({
  controllers: [NotificacaoController],
  providers:   [NotificacaoService],
  exports:     [NotificacaoService],
})
export class NotificacaoModule {}
