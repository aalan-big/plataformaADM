/**
 * ============================================================================
 * NOME DO ARQUIVO: plano.module.ts
 * MÓDULO: PLANO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de PLANO. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 *
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * - Declaração de Controllers.
 * - Importação de outros módulos necessários para este funcionar.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { PlanoController } from './plano.controller'
import { PlanoService } from './plano.service'

@Module({
  controllers: [PlanoController],
  providers:   [PlanoService],
})
export class PlanoModule {}
