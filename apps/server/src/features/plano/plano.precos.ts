/**
 * ============================================================================
 * NOME DO ARQUIVO: plano.precos.ts
 * MÓDULO: PLANO
 * ============================================================================
 * Monta as opções de período que o cliente vê na hora de pagar.
 *
 * Vive fora dos services porque vários caminhos precisam exatamente do mesmo
 * cálculo: a renovação (que parte de uma licença), a contratação pública (que
 * parte só do plano, porque o cliente ainda não existe) e agora a renovação
 * pelo ERP, que também oferece PIX. Duplicar isso seria garantir que um dia os
 * dois divergissem — e divergência aqui é a tela mostrar um preço e o gateway
 * cobrar outro.
 *
 * Por isso a conta mora em `calcularPeriodos`, num lugar só, e as funções
 * públicas apenas decidem O QUE FILTRAR do resultado. Elas nunca recalculam.
 * ============================================================================
 */

export type MetodoPagamento = 'PIX' | 'CARTAO'

export type OpcaoPeriodo = {
  meses:    number
  label:    string
  total:    number
  desconto: number
}

export type OpcaoPeriodoComMetodos = OpcaoPeriodo & {
  metodos: MetodoPagamento[]
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

type PeriodoCalculado = OpcaoPeriodo & {
  /** Price recorrente no catálogo do Stripe. Sem ele, não há como cobrar cartão. */
  priceId: string | null
  /**
   * O plano tem preço CADASTRADO para este período (e não um valor derivado do
   * mensal por desconto). Ver a nota em `montarOpcoesComMetodos` sobre por que
   * isso importa para o PIX.
   */
  precoExplicito: boolean
}

/** A conta, num lugar só. Devolve sempre os três períodos, sem filtrar nada. */
function calcularPeriodos(plano: PlanoPrecificavel): PeriodoCalculado[] {
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

  return [
    { meses: 1,  label: 'Mensal',     total: parseFloat(preco.toFixed(2)), desconto: 0,
      priceId: plano.stripePriceIdMensal,     precoExplicito: plano.precoMensal     != null },
    { meses: 3,  label: 'Trimestral', total: totalTri,                     desconto: descontoEfetivo(totalTri, 3),
      priceId: plano.stripePriceIdTrimestral, precoExplicito: plano.precoTrimestral != null },
    { meses: 12, label: 'Anual',      total: totalAnu,                     desconto: descontoEfetivo(totalAnu, 12),
      priceId: plano.stripePriceIdAnual,      precoExplicito: plano.precoAnual      != null },
  ]
}

/**
 * Opções pagáveis por CARTÃO (Stripe). Comportamento inalterado desde sempre.
 *
 * Só entra o período que tem Price configurado. Botão de pagar que resulta em
 * erro do gateway é pior do que a opção não existir: o cliente conclui que o
 * sistema está quebrado e desiste da compra.
 *
 * Cuidado ao mexer: esta função NÃO é só exibição. A contratação pública usa o
 * retorno dela como validação do período escolhido (`erp-contratacao.service`),
 * então afrouxar o filtro faz o site aceitar uma compra que vai falhar no
 * checkout — depois de já ter criado cliente e licença, com o e-mail preso.
 */
export function montarOpcoes(plano: PlanoPrecificavel): OpcaoPeriodo[] {
  return calcularPeriodos(plano)
    .filter(o => !!o.priceId)
    .map(({ priceId: _priceId, precoExplicito: _precoExplicito, ...opcao }) => opcao)
}

/**
 * Opções com os meios de pagamento aceitos em cada período — o que o ERP local
 * usa para desenhar a tela de renovação.
 *
 * PIX não depende do catálogo do Stripe, então um período sem Price ainda pode
 * ser vendido por PIX. É isso que torna vendável um plano cadastrado sem Price
 * nenhum, que hoje simplesmente não aparece para ninguém.
 *
 * Mas PIX exige `precoExplicito`: nunca oferecemos um período cujo valor foi
 * DERIVADO do mensal por desconto. O fallback existe para estimar uma vitrine,
 * não para definir quanto cobrar — inventar um trimestral a partir do mensal
 * seria a plataforma tomando sozinha uma decisão comercial que ninguém tomou.
 * Período sem preço próprio simplesmente não é oferecido no PIX.
 */
export function montarOpcoesComMetodos(
  plano:    PlanoPrecificavel,
  contexto: { pixDisponivel: boolean },
): OpcaoPeriodoComMetodos[] {
  return calcularPeriodos(plano)
    .map(({ priceId, precoExplicito, ...opcao }) => {
      const metodos: MetodoPagamento[] = []
      if (priceId) metodos.push('CARTAO')
      if (contexto.pixDisponivel && precoExplicito && opcao.total > 0) metodos.push('PIX')
      return { ...opcao, metodos }
    })
    .filter(o => o.metodos.length > 0)
}
