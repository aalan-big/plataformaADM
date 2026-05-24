import { z } from 'zod'
import { criarClientePFSchema } from './pf/cliente-pf.schema'
import { criarClientePJSchema } from './pj/cliente-pj.schema'

// O tipo PF/PJ é deduzido pela presença de cpf (PF) ou cnpj (PJ) no payload.
// Zod tenta PF primeiro; se cpf não estiver presente/válido, tenta PJ.
export const criarClienteUnificadoSchema = z.union([criarClientePFSchema, criarClientePJSchema])

export type CriarClienteUnificadoInput = z.infer<typeof criarClienteUnificadoSchema>
