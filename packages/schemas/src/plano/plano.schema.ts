import { z } from 'zod'

export const criarPlanoSchema = z.object({
  nome:                   z.string().min(2),
  // Exibida ao cliente no checkout do Stripe. O limite é o do próprio campo do
  // Stripe; acima disso o texto vira um bloco denso na tela de pagamento.
  descricaoCheckout:      z.string().max(500).optional(),
  // Exibir na página pública de contratação. Fora daqui o plano existe, mas
  // ninguém chega nele pelo site.
  publico:                z.boolean().optional(),
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
  /**
   * Módulos inclusos neste plano, pelo identificador do catálogo.
   *
   * O formulário manda sempre o conjunto COMPLETO, e omitir o campo significa
   * "não mexe nos módulos" — é o que permite salvar preço sem tocar no que o
   * plano libera. Lista vazia, ao contrário, significa "nenhum módulo".
   */
  modulos: z.array(z.object({
    identificador: z.string().min(1),
    // Teto mensal deste módulo neste plano. `null` = sem teto.
    cotaMensal:    z.number().int().min(0).nullable().optional(),
  })).optional(),
})

export const editarPlanoSchema = criarPlanoSchema.partial()

export type CriarPlanoInput = z.infer<typeof criarPlanoSchema>
export type EditarPlanoInput = z.infer<typeof editarPlanoSchema>
