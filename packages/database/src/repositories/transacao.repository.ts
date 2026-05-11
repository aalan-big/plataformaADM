import { prisma } from '../client'
import type { TipoTransacao } from '@prisma/client'

export async function criarTransacao(dados: {
  clienteId:    string
  licencaId?:   string
  pagamentoId?: string
  tipo:         TipoTransacao
  valor:        number
  origem?:      string
  descricao?:   string
}) {
  return prisma.transacaoHistorico.create({
    data: {
      clienteId:   dados.clienteId,
      licencaId:   dados.licencaId,
      pagamentoId: dados.pagamentoId,
      tipo:        dados.tipo,
      valor:       dados.valor,
      origem:      dados.origem ?? 'MANUAL',
      descricao:   dados.descricao,
    },
  })
}

export async function findTransacoesByClienteId(clienteId: string) {
  return prisma.transacaoHistorico.findMany({
    where:   { clienteId },
    orderBy: { criadoEm: 'desc' },
    include: {
      licenca:   { select: { nomeDispositivo: true, chaveAtivacao: true, plano: { select: { nome: true } } } },
      pagamento: { select: { valor: true, meses: true, gateway: true, status: true } },
    },
  })
}

export async function findTransacoesByLicencaId(licencaId: string) {
  return prisma.transacaoHistorico.findMany({
    where:   { licencaId },
    orderBy: { criadoEm: 'desc' },
    include: {
      pagamento: { select: { valor: true, meses: true, gateway: true, status: true } },
    },
  })
}

export async function sumTransacoesMes(ano: number, mes: number) {
  const inicio = new Date(ano, mes - 1, 1)
  const fim    = new Date(ano, mes, 1)
  const result = await prisma.transacaoHistorico.aggregate({
    where:  { tipo: 'PAGAMENTO_RECEBIDO', criadoEm: { gte: inicio, lt: fim } },
    _sum:   { valor: true },
    _count: true,
  })
  return {
    total:      Number(result._sum.valor ?? 0),
    quantidade: result._count,
  }
}
