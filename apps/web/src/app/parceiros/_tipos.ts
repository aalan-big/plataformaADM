export type Parceiro = {
  id:                 string
  codigo:             string
  nomeParceiro:       string
  documento:          string | null
  email:              string | null
  contatoCelular:     string | null
  cidadeBase:         string | null
  status:             string
  tipoComissao:       string
  valorComissaoFixa:  number | string | null
  comissaoPercentual: number | string | null
  observacoes:        string | null
  criadoEm:           string
  _count?:            { clientes: number; comissoes: number }
}

export type Comissao = {
  id:          string
  competencia: string
  valorBase:   number | string
  meses:       number
  tipoComissao: string
  parametro:   number | string
  valor:       number | string
  status:      string
  pagoEm:      string | null
  referenciaPagamento: string | null
  criadoEm:    string
  parceiro?:  { id: string; codigo: string; nomeParceiro: string }
  cliente?:   { email: string; pf: { nomeCompleto: string } | null; pj: { razaoSocial: string } | null }
  pagamento?: { gateway: string; criadoEm: string; transacaoId: string | null }
}

export type LinhaRepasse = {
  parceiro:   { id: string; codigo: string; nomeParceiro: string; email: string | null; status: string } | null
  status:     string
  quantidade: number
  total:      number
}

export type ParceiroDetalhe = Parceiro & {
  clientes: {
    id: string
    email: string
    criadoEm: string
    pf: { nomeCompleto: string } | null
    pj: { razaoSocial: string } | null
    dispositivos: { id: string; status: string; dataVencimento: string | null; plano: { nome: string } | null }[]
  }[]
  comissoes: Comissao[]
  totais:    { pendente: number; pago: number; cancelado: number }
}

export const formatarReais = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const formatarData = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Nome de exibição do cliente, com o e-mail como último recurso. */
export const nomeCliente = (c?: { email: string; pf: { nomeCompleto: string } | null; pj: { razaoSocial: string } | null }) =>
  c ? (c.pf?.nomeCompleto ?? c.pj?.razaoSocial ?? c.email) : '—'

/** Regra de comissão do parceiro, em texto curto. */
export const regraComissao = (p: Parceiro) =>
  p.tipoComissao === 'PERCENTUAL'
    ? `${Number(p.comissaoPercentual ?? 0)}% do valor pago`
    : `${formatarReais(p.valorComissaoFixa)} por mês`

/** Competência atual no formato usado pelo backend. */
export const competenciaAtual = () => new Date().toISOString().slice(0, 7)

export const rotuloCompetencia = (c: string) => {
  const [ano, mes] = c.split('-')
  const nomes = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
  const i = Number(mes) - 1
  return nomes[i] ? `${nomes[i]} de ${ano}` : c
}
