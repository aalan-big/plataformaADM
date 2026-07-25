/**
 * ============================================================================
 * NOME DO ARQUIVO: plano.precos.ts
 * MÓDULO: PLANO
 * ============================================================================
 * Monta as opções de período que o cliente vê na hora de pagar.
 *
 * Vive fora dos services porque dois caminhos precisam exatamente do mesmo
 * cálculo: a renovação (que parte de uma licença) e a contratação pública (que
 * parte só do plano, porque o cliente ainda não existe). Duplicar isso seria
 * garantir que um dia os dois divergissem — e divergência aqui é a tela mostrar
 * um preço e o Stripe cobrar outro.
 * ============================================================================
 */

export type OpcaoPeriodo = {
  meses:    number
  label:    string
  total:    number
  desconto: number
}

type PlanoPrecificavel = {
  precoMensal:             unknown
  precoTrimestral:         unknown
  precoAnual:              unknown
  descontoTrimestral:      unknown
  descontoAnual:           unknown
  stripePriceIdMensal:     string | null
  stripePriceIdTrimestral: string | null
  stripePriceIdAnual:      string | null
}

export function montarOpcoes(plano: PlanoPrecificavel): OpcaoPeriodo[] {
  const preco   = Number(plano.precoMensal)
  const descTri = plano.descontoTrimestral ? Number(plano.descontoTrimestral) / 100 : 0
  const descAnu = plano.descontoAnual      ? Number(plano.descontoAnual)      / 100 : 0

  // O preço fechado do período manda quando existe: é ele que corresponde ao
  // Price cadastrado no Stripe, e é o Stripe quem cobra. O cálculo por desconto
  // sobre o mensal fica como fallback de plano sem preço fechado.
  const totalDoPeriodo = (precoFechado: unknown, meses: number, desconto: number) =>
    precoFechado != null ? Number(precoFechado) : preco * meses * (1 - desconto)

  // Percentual exibido derivado do total real, para a tela não anunciar um
  // desconto que não corresponde ao valor cobrado.
  const descontoEfetivo = (total: number, meses: number) =>
    preco > 0 ? Math.max(0, 1 - total / (preco * meses)) : 0

  const totalTri = parseFloat(totalDoPeriodo(plano.precoTrimestral, 3,  descTri).toFixed(2))
  const totalAnu = parseFloat(totalDoPeriodo(plano.precoAnual,      12, descAnu).toFixed(2))

  // Só entra o período que tem Price configurado. Botão de pagar que resulta em
  // erro do gateway é pior do que a opção não existir: o cliente conclui que o
  // sistema está quebrado e desiste da compra.
  return [
    { meses: 1,  label: 'Mensal',     total: parseFloat(preco.toFixed(2)), desconto: 0,                            priceId: plano.stripePriceIdMensal     },
    { meses: 3,  label: 'Trimestral', total: totalTri,                     desconto: descontoEfetivo(totalTri, 3),  priceId: plano.stripePriceIdTrimestral },
    { meses: 12, label: 'Anual',      total: totalAnu,                     desconto: descontoEfetivo(totalAnu, 12), priceId: plano.stripePriceIdAnual      },
  ]
    .filter(o => !!o.priceId)
    .map(({ priceId: _priceId, ...opcao }) => opcao)
}
