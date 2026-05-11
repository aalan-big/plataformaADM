/*
 * ARQUIVO: Schemas de Validação (Zod)
 * POSIÇÃO: Camada de Validação / DTO (Data Transfer Object)
 * FUNÇÃO: Garantir que os dados enviados pelo formulário estão corretos.
 * É o "filtro" que protege o seu banco de dados de informações erradas.
 */

import { z } from 'zod'

// Constante para evitar erros de digitação (String Literal)
export const CARGO_PADRAO = 'ADMIN' as const

// SCHEMA DE CRIAÇÃO: Regras para quando você vai cadastrar um usuário NOVO
export const criarUsuarioSchema = z.object({
  nome: z
    .string()
    .min(3, 'O nome precisa ter pelo menos 3 caracteres.'),

  email: z
    .string()
    .min(1, 'O e-mail é obrigatório.')
    .email('Insira um endereço de e-mail válido.'),

  senha: z
    .string()
    .min(6, 'A senha precisa ter no mínimo 6 caracteres.'),

  // Enum: Só aceita exatamente uma dessas três palavras
  cargo: z
    .enum(['ADMIN', 'GERENTE', 'SUPORTE'])
    .default(CARGO_PADRAO),
})

// SCHEMA DE EDIÇÃO: Regras para quando você vai ATUALIZAR um usuário
// A diferença aqui é o '.optional()', pois o usuário pode querer mudar só o nome e manter a senha
export const editarUsuarioSchema = z.object({
  nome: z.string().min(3).optional(),
  email: z.string().email().optional(),
  senha: z.string().min(6).optional(),
  cargo: z.enum(['ADMIN', 'GERENTE', 'SUPORTE']).optional(),
})

/**
 * TIPAGENS AUTOMÁTICAS
 * O Zod cria os tipos do TypeScript sozinho baseados nas regras acima.
 * Isso evita que você tenha que escrever 'interface' manualmente.
 */
export type CriarUsuarioInput = z.infer<typeof criarUsuarioSchema>
export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>
