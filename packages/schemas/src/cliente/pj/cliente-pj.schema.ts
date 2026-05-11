import { z } from 'zod'
import { clienteBaseSchema } from '../cliente.schema'
import { validarCnpj } from '../../core/documento.validators'

export const criarClientePJSchema = clienteBaseSchema.omit({ tipo: true }).extend({
  razaoSocial:       z.string().min(2, { message: 'Razão social obrigatória' }),

  cnpj: z.string()
    .transform(s => s.replace(/\D/g, ''))
    .pipe(z.string()
      .length(14, { message: 'CNPJ inválido' })
      .refine(validarCnpj, { message: 'CNPJ inválido (dígitos verificadores incorretos)' })
    ),

  nomeFantasia:      z.string().optional(),
  inscricaoEstadual: z.string().optional(),
  responsavel:       z.string().optional(),
})

export const editarClientePJSchema = criarClientePJSchema.partial()

export type CriarClientePJInput = z.infer<typeof criarClientePJSchema>
export type EditarClientePJInput = z.infer<typeof editarClientePJSchema>
