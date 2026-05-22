import { z } from 'zod'

export const clienteBaseSchema = z.object({
  tipo:       z.enum(['PF', 'PJ']),
  email:      z.string().email({ message: 'E-mail inválido' }).transform(s => s.toLowerCase()),
  usuarioId:  z.string().uuid({ message: 'usuarioId inválido' }),
  parceiroId: z.string().uuid({ message: 'parceiroId inválido' }).optional(),
})

export const editarClienteBaseSchema = clienteBaseSchema.omit({ tipo: true }).partial()

export type ClienteBaseInput = z.infer<typeof clienteBaseSchema>
export type EditarClienteBaseInput = z.infer<typeof editarClienteBaseSchema>
