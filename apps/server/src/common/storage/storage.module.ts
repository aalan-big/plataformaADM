/**
 * ============================================================================
 * NOME DO ARQUIVO: storage.module.ts
 * MÓDULO: COMMON/STORAGE
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de STORAGE. Ele agrupa
 * os Providers deste módulo e diz ao NestJS como eles se conectam.
 *
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * ============================================================================
 */
import { Global, Module } from '@nestjs/common'
import { StorageService } from './storage.service'

@Global()
@Module({
  providers: [StorageService],
  exports:   [StorageService],
})
export class StorageModule {}
