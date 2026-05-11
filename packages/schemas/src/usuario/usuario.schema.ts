import { z } from 'zod'

export const CARGO_PADRAO = 'ADMIN' as const

export const criarUsuarioSchema = z.object({
  nome: z.string().min(3, 'O nome precisa ter pelo menos 3 caracteres.'),
  email: z.string().min(1, 'O e-mail é obrigatório.').email('Insira um endereço de e-mail válido.'),
  senha: z.string().min(6, 'A senha precisa ter no mínimo 6 caracteres.'),
  cargo: z.enum(['ADMIN', 'GERENTE', 'SUPORTE']).default(CARGO_PADRAO),
})

export const editarUsuarioSchema = z.object({
  nome: z.string().min(3).optional(),
  email: z.string().email().optional(),
  senha: z.string().min(6).optional(),
  cargo: z.enum(['ADMIN', 'GERENTE', 'SUPORTE']).optional(),
})

export type CriarUsuarioInput = z.infer<typeof criarUsuarioSchema>
export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>
