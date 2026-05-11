import { z } from 'zod'

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'O e-mail é obrigatório.')
    .email('Insira um endereço de e-mail válido.')
    .max(255, 'O e-mail excede o limite de caracteres permitidos.'),

  senha: z
    .string()
    .min(6, 'A senha precisa ter no mínimo 6 caracteres.')
    .max(100, 'A senha excede o limite de caracteres permitidos.'),
})

export type LoginInput = z.infer<typeof loginSchema>
