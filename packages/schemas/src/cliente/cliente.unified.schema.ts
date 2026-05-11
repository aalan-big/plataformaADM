import { z } from 'zod'
import { criarClientePFSchema } from './pf/cliente-pf.schema'
import { criarClientePJSchema } from './pj/cliente-pj.schema'

const pfUnificado = criarClientePFSchema.extend({ tipo: z.literal('PF') })
const pjUnificado = criarClientePJSchema.extend({ tipo: z.literal('PJ') })

export const criarClienteUnificadoSchema = z.discriminatedUnion('tipo', [pfUnificado, pjUnificado])

export type CriarClienteUnificadoInput = z.infer<typeof criarClienteUnificadoSchema>
