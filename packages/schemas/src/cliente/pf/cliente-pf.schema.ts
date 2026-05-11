import { z } from 'zod'
import { clienteBaseSchema } from '../cliente.schema'
import { validarCpf } from '../../core/documento.validators'

export const criarClientePFSchema = clienteBaseSchema.omit({ tipo: true }).extend({
  nomeCompleto:   z.string().min(2, { message: 'Nome completo obrigatório' }),

  cpf: z.string()
    .transform(s => s.replace(/\D/g, ''))
    .pipe(z.string()
      .length(11, { message: 'CPF inválido' })
      .refine(validarCpf, { message: 'CPF inválido (dígitos verificadores incorretos)' })
    ),

  rg: z.string().optional(),

  dataNascimento: z.string()
    .refine(s => !isNaN(Date.parse(s)), { message: 'Data de nascimento inválida' })
    .optional(),
})

export const editarClientePFSchema = criarClientePFSchema.partial()

export type CriarClientePFInput = z.infer<typeof criarClientePFSchema>
export type EditarClientePFInput = z.infer<typeof editarClientePFSchema>
