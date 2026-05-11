import { prisma } from '../client'

export async function criarPagamento(dados: {
  licencaId:   string
  clienteId:   string
  valor:       number
  meses:       number
  gateway?:    string
  transacaoId?: string
  observacao?: string
}) {
  return prisma.pagamento.create({
    data: {
      licencaId:   dados.licencaId,
      clienteId:   dados.clienteId,
      valor:       dados.valor,
      meses:       dados.meses,
      status:      'PAGO',
      gateway:     dados.gateway ?? 'MANUAL',
      transacaoId: dados.transacaoId,
      observacao:  dados.observacao,
    },
  })
}

export async function findPagamentosByClienteId(clienteId: string) {
  return prisma.pagamento.findMany({
    where:   { clienteId },
    orderBy: { criadoEm: 'desc' },
    include: {
      licenca: { select: { nomeDispositivo: true, plano: { select: { nome: true } } } },
    },
  })
}

export async function findPagamentosByLicencaId(licencaId: string) {
  return prisma.pagamento.findMany({
    where:   { licencaId },
    orderBy: { criadoEm: 'desc' },
  })
}

export async function findPagamentoByTransacaoId(transacaoId: string) {
  return prisma.pagamento.findUnique({ where: { transacaoId } })
}

export async function findAllPagamentos(filtro?: {
  ano?:     number
  mes?:     number
  gateway?: string
  q?:       string
}) {
  const inicio = filtro?.ano && filtro?.mes ? new Date(filtro.ano, filtro.mes - 1, 1) : undefined
  const fim    = filtro?.ano && filtro?.mes ? new Date(filtro.ano, filtro.mes,     1) : undefined

  return prisma.pagamento.findMany({
    where: {
      ...(inicio && fim ? { criadoEm: { gte: inicio, lt: fim } } : {}),
      ...(filtro?.gateway ? { gateway: filtro.gateway } : {}),
      ...(filtro?.q ? {
        OR: [
          { cliente: { pf: { nomeCompleto: { contains: filtro.q, mode: 'insensitive' } } } },
          { cliente: { pj: { razaoSocial:  { contains: filtro.q, mode: 'insensitive' } } } },
          { cliente: { email: { contains: filtro.q, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    include: {
      cliente: { include: { pf: true, pj: true } },
      licenca: { select: { nomeDispositivo: true, plano: { select: { nome: true } } } },
    },
    orderBy: { criadoEm: 'desc' },
    take:    500,
  })
}

export async function sumReceitaMes(ano: number, mes: number) {
  const inicio = new Date(ano, mes - 1, 1)
  const fim    = new Date(ano, mes, 1)
  const result = await prisma.pagamento.aggregate({
    where:  { status: 'PAGO', criadoEm: { gte: inicio, lt: fim } },
    _sum:   { valor: true },
    _count: true,
  })
  return {
    total:      Number(result._sum.valor ?? 0),
    quantidade: result._count,
  }
}
