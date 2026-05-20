/**
 * ============================================================================
 * NOME DO ARQUIVO: public.decorator.ts
 * MÓDULO: CORE/GERAL
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Um atalho visual (Anotação) usado para adicionar metadados nas rotas da API.
 * Facilita a leitura e configuração de segurança.
 * 
 * O QUE ELE CONTÉM:
 * - Lógica de extração de dados do Request ou injeção de permissões.
 * ============================================================================
 */
import { SetMetadata } from '@nestjs/common'

export const PUBLIC_KEY = 'isPublic'
export const Public = () => SetMetadata(PUBLIC_KEY, true)
