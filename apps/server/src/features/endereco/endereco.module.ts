/**
 * ============================================================================
 * NOME DO ARQUIVO: endereco.module.ts
 * MÓDULO: ENDERECO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de ENDERECO. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 * 
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * - Declaração de Controllers.
 * - Importação de outros módulos necessários para este funcionar.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { EnderecoController } from './endereco.controller'
import { EnderecoService } from './endereco.service'

@Module({
  controllers: [EnderecoController],
  providers: [EnderecoService],
})
export class EnderecoModule {}
