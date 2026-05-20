/**
 * ============================================================================
 * NOME DO ARQUIVO: usuario.module.ts
 * MÓDULO: USUARIO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de USUARIO. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 * 
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * - Declaração de Controllers.
 * - Importação de outros módulos necessários para este funcionar.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { UsuarioController } from './usuario.controller'
import { UsuarioService } from './usuario.service'

@Module({
  controllers: [UsuarioController],
  providers: [UsuarioService],
})
export class UsuarioModule {}
