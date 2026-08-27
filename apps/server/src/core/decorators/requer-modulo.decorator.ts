/**
 * ============================================================================
 * NOME DO ARQUIVO: requer-modulo.decorator.ts
 * MÓDULO: CORE/GERAL
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Marca uma rota como pertencente a um módulo vendável. O `ModuloGuard` lê este
 * metadado e confere contra a lista `modulos` do JWT da licença.
 * ============================================================================
 */
import { SetMetadata } from '@nestjs/common'

export const MODULO_KEY = 'modulo_requerido'

/**
 * Aplique no controller (vale para todas as rotas dele) ou em um método
 * específico. Rota sem este decorator não é verificada — o guard só age onde
 * alguém disse explicitamente que existe um módulo por trás.
 */
export const RequerModulo = (identificador: string) => SetMetadata(MODULO_KEY, identificador)
