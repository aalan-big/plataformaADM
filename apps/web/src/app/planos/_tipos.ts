export type Plano = {
  id:                      string
  nome:                    string
  descricaoCheckout:       string | null
  publico:                 boolean
  limiteUsuario:           number
  precoMensal:             number | string
  precoTrimestral:         number | string | null
  precoAnual:              number | string | null
  valorLicencaAdicional:   number | string | null
  descontoTrimestral:      number | string | null
  descontoAnual:           number | string | null
  stripePriceIdMensal:     string | null
  stripePriceIdTrimestral: string | null
  stripePriceIdAnual:      string | null
  status:                  string
  criadoEm:                string
  _count?:                 { licencas: number }
}

/** Períodos de cobrança na ordem em que aparecem para o cliente. */
export const PERIODOS = [
  { chave: 'mensal'     as const, label: 'Mensal'     },
  { chave: 'trimestral' as const, label: 'Trimestral' },
  { chave: 'anual'      as const, label: 'Anual'      },
]

export function precoDoPeriodo(p: Plano, chave: 'mensal' | 'trimestral' | 'anual') {
  if (chave === 'mensal')     return p.precoMensal
  if (chave === 'trimestral') return p.precoTrimestral
  return p.precoAnual
}

export function priceIdDoPeriodo(p: Plano, chave: 'mensal' | 'trimestral' | 'anual') {
  if (chave === 'mensal')     return p.stripePriceIdMensal
  if (chave === 'trimestral') return p.stripePriceIdTrimestral
  return p.stripePriceIdAnual
}

/**
 * Períodos com preço cadastrado mas sem Price no Stripe. É o estado que faz a
 * opção sumir da tela de pagamento sem ninguém perceber — e o que o botão de
 * sincronizar resolve.
 */
export function periodosPendentes(p: Plano) {
  return PERIODOS.filter(({ chave }) => {
    const preco = precoDoPeriodo(p, chave)
    return preco != null && Number(preco) > 0 && !priceIdDoPeriodo(p, chave)
  }).map(({ label }) => label)
}

export function formatarReais(valor: number | string | null) {
  if (valor == null) return '—'
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
