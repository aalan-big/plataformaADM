import { z } from 'zod'

export const criarEnderecoSchema = z.object({
  clienteId:   z.string().uuid(),
  cep:         z.string().min(8, { message: 'CEP inválido' }).max(9),
  logradouro:  z.string().min(2, { message: 'Logradouro obrigatório' }),
  numero:      z.string().min(1, { message: 'Número obrigatório' }),
  complemento: z.string().optional(),
  bairro:      z.string().min(2, { message: 'Bairro obrigatório' }),
  cidade:      z.string().min(2, { message: 'Cidade obrigatória' }),
  estado:      z.string().length(2, { message: 'Use a sigla do estado (ex: CE)' }),
  tipo:        z.enum(['PRINCIPAL', 'FILIAL', 'COBRANCA', 'ENTREGA']).default('PRINCIPAL'),
})

export const editarEnderecoSchema = criarEnderecoSchema.omit({ clienteId: true }).partial()

export type CriarEnderecoInput = z.infer<typeof criarEnderecoSchema>
export type EditarEnderecoInput = z.infer<typeof editarEnderecoSchema>
