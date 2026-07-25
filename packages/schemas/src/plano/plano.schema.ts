import { z } from 'zod'

export const criarPlanoSchema = z.object({
  nome:                   z.string().min(2),
  // Exibida ao cliente no checkout do Stripe. O limite é o do próprio campo do
  // Stripe; acima disso o texto vira um bloco denso na tela de pagamento.
  descricaoCheckout:      z.string().max(500).optional(),
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
