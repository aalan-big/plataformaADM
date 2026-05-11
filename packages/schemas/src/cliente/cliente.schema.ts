import { z } from 'zod'

export const clienteBaseSchema = z.object({
  tipo:     z.enum(['PF', 'PJ']),
  contato:  z.string().min(2, { message: 'Contato obrigatório' }),
  email: z.string().email({ message: 'E-mail inválido' }).transform(s => s.toLowerCase()),
  plano:    z.enum(['Start', 'Premium']).default('Start'),
  licencas: z.number().int().min(1).default(1),
  parceiro: z.string().min(2, { message: 'Parceiro obrigatório' }),
  status:   z.enum(['PAGO', 'ATRASADO']).default('PAGO'),
})

export const editarClienteBaseSchema = clienteBaseSchema.omit({ tipo: true }).partial()

export type ClienteBaseInput = z.infer<typeof clienteBaseSchema>
export type EditarClienteBaseInput = z.infer<typeof editarClienteBaseSchema>
