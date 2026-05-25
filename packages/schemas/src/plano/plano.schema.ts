import { z } from 'zod'

export const criarPlanoSchema = z.object({
  nome:                   z.string().min(2),
  limiteUsuario:          z.number().int().min(1),
  precoMensal:            z.number().min(0),
  precoTrimestral:        z.number().min(0).optional(),
  precoAnual:             z.number().min(0).optional(),
  valorLicencaAdicional:  z.number().min(0).optional(),
  descontoTrimestral:     z.number().min(0).max(100).optional(),
  descontoAnual:          z.number().min(0).max(100).optional(),
  stripePriceIdMensal:    z.string().optional(),
  stripePriceIdTrimestral: z.string().optional(),
  stripePriceIdAnual:     z.string().optional(),
})

export const editarPlanoSchema = criarPlanoSchema.partial()

export type CriarPlanoInput = z.infer<typeof criarPlanoSchema>
export type EditarPlanoInput = z.infer<typeof editarPlanoSchema>
