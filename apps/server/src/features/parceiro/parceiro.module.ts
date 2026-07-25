/**
 * ============================================================================
 * NOME DO ARQUIVO: parceiro.module.ts
 * MÓDULO: PARCEIRO
 * ============================================================================
 * Wiring do módulo de parceiros. O service é exportado porque o módulo de
 * FINANCEIRO depende dele: é lá que o pagamento entra, e é no ato do pagamento
 * que a comissão precisa ser apurada.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { ParceiroController } from './parceiro.controller'
import { ParceiroService } from './parceiro.service'

@Module({
  controllers: [ParceiroController],
  providers:   [ParceiroService],
  exports:     [ParceiroService],
})
export class ParceiroModule {}
