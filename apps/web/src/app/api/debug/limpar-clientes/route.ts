import { NextResponse } from 'next/server'
import { prisma } from '@startbig/database'

export async function DELETE() {
  const [transacoes, pagamentos, clientes] = await prisma.$transaction([
    prisma.transacaoHistorico.deleteMany(),
    prisma.pagamento.deleteMany(),
    prisma.cliente.deleteMany(),
  ])

  return NextResponse.json({
    ok: true,
    deletados: {
      transacoes: transacoes.count,
      pagamentos: pagamentos.count,
      clientes:   clientes.count,
    },
  })
}
