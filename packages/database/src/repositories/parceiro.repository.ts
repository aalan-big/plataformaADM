import { prisma } from '../client'

// ── Parceiro ─────────────────────────────────────────────────────────────────

export async function findAllParceiros(filtro?: { status?: string; q?: string }) {
  return prisma.parceiro.findMany({
    where: {
      ...(filtro?.status ? { status: filtro.status } : {}),
      ...(filtro?.q
        ? {
            OR: [
              { nomeParceiro: { contains: filtro.q, mode: 'insensitive' as const } },
              { codigo:       { contains: filtro.q, mode: 'insensitive' as const } },
              { email:        { contains: filtro.q, mode: 'insensitive' as const } },
              { documento:    { contains: filtro.q } },
            ],
          }
        : {}),
    },
    orderBy: { nomeParceiro: 'asc' },
    include: { _count: { select: { clientes: true, comissoes: true } } },
  })
}

export async function findParceiroById(id: string) {
  return prisma.parceiro.findUnique({
    where:   { id },
    include: { _count: { select: { clientes: true, comissoes: true } } },
  })
}

export async function findParceiroByCodigo(codigo: string) {
  return prisma.parceiro.findUnique({ where: { codigo } })
}

export async function criarParceiro(data: {
  codigo:             string
  nomeParceiro:       string
  documento?:         string
  email?:             string
  contatoCelular?:    string
  cidadeBase?:        string
  tipoComissao?:      string
  valorComissaoFixa?: number
  comissaoPercentual?: number
  observacoes?:       string
}) {
  return prisma.parceiro.create({ data })
}

export async function updateParceiro(id: string, data: {
  codigo?:             string
  nomeParceiro?:       string
  documento?:          string | null
  email?:              string | null
  contatoCelular?:     string | null
  cidadeBase?:         string | null
  status?:             string
  tipoComissao?:       string
  valorComissaoFixa?:  number | null
  comissaoPercentual?: number | null
  observacoes?:        string | null
}) {
  return prisma.parceiro.update({ where: { id }, data })
}

/** Clientes vinculados a um parceiro, com o que cada um já rendeu de comissão. */
export async function findClientesDoParceiro(parceiroId: string) {
  return prisma.cliente.findMany({
    where:   { parceiroId },
    orderBy: { criadoEm: 'desc' },
    select: {
      id: true, email: true, criadoEm: true,
      pf: { select: { nomeCompleto: true } },
      pj: { select: { razaoSocial: true } },
      dispositivos: {
        select: { id: true, status: true, dataVencimento: true, plano: { select: { nome: true } } },
        orderBy: { criadoEm: 'desc' },
        take: 1,
      },
    },
  })
}

/** Troca (ou remove) o parceiro de um cliente. `parceiroId: null` desvincula. */
export async function vincularClienteAoParceiro(clienteId: string, parceiroId: string | null) {
  return prisma.cliente.update({
    where: { id: clienteId },
    data:  { parceiroId },
    select: { id: true, email: true, parceiroId: true },
  })
}

// ── Comissões ────────────────────────────────────────────────────────────────

export async function criarComissao(data: {
  parceiroId:   string
  clienteId:    string
  licencaId?:   string | null
  pagamentoId:  string
  competencia:  string
  valorBase:    number
  meses:        number
  tipoComissao: string
  parametro:    number
  valor:        number
  observacao?:  string
}) {
  return prisma.comissaoParceiro.create({ data })
}

export async function findComissaoByPagamento(pagamentoId: string) {
  return prisma.comissaoParceiro.findUnique({ where: { pagamentoId } })
}

export async function findComissoes(filtro: {
  parceiroId?:  string
  status?:      string
  competencia?: string
}) {
  return prisma.comissaoParceiro.findMany({
    where: {
      ...(filtro.parceiroId  ? { parceiroId:  filtro.parceiroId }  : {}),
      ...(filtro.status      ? { status:      filtro.status }      : {}),
      ...(filtro.competencia ? { competencia: filtro.competencia } : {}),
    },
    orderBy: { criadoEm: 'desc' },
    include: {
      parceiro: { select: { id: true, codigo: true, nomeParceiro: true } },
      cliente:  { select: { email: true, pf: { select: { nomeCompleto: true } }, pj: { select: { razaoSocial: true } } } },
      pagamento: { select: { gateway: true, criadoEm: true, transacaoId: true } },
    },
  })
}

/**
 * Total a repassar por parceiro numa competência. É a consulta que responde
 * "quanto eu pago para cada um este mês".
 */
export async function resumoRepasse(filtro: { competencia?: string; status?: string }) {
  const agrupado = await prisma.comissaoParceiro.groupBy({
    by:    ['parceiroId', 'status'],
    where: {
      ...(filtro.competencia ? { competencia: filtro.competencia } : {}),
      ...(filtro.status      ? { status:      filtro.status }      : {}),
    },
    _sum:   { valor: true },
    _count: { _all: true },
  })

  const parceiros = await prisma.parceiro.findMany({
    where:  { id: { in: [...new Set(agrupado.map(g => g.parceiroId))] } },
    select: { id: true, codigo: true, nomeParceiro: true, email: true, status: true },
  })

  return agrupado.map(g => ({
    parceiro:   parceiros.find(p => p.id === g.parceiroId) ?? null,
    status:     g.status,
    quantidade: g._count._all,
    total:      Number(g._sum.valor ?? 0),
  }))
}

/** Baixa de repasse: marca um lote de comissões como PAGA. */
export async function marcarComissoesPagas(ids: string[], dados: {
  referenciaPagamento?: string
  observacao?:          string
}) {
  return prisma.comissaoParceiro.updateMany({
    where: { id: { in: ids }, status: 'PENDENTE' },
    data: {
      status:              'PAGA',
      pagoEm:              new Date(),
      referenciaPagamento: dados.referenciaPagamento,
      observacao:          dados.observacao,
    },
  })
}

/**
 * Cancela a comissão de um pagamento — usado quando o pagamento é estornado.
 * Só mexe no que ainda está PENDENTE: comissão já paga ao parceiro vira acerto
 * manual, não some do histórico.
 */
export async function cancelarComissaoDoPagamento(pagamentoId: string, motivo: string) {
  return prisma.comissaoParceiro.updateMany({
    where: { pagamentoId, status: 'PENDENTE' },
    data:  { status: 'CANCELADA', observacao: motivo },
  })
}
