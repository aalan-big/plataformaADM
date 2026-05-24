import { prisma } from '../client'
import type { CriarClientePJInput, EditarClientePJInput } from '@startbig/schemas'

export async function findClientePJByCnpj(cnpj: string) {
  return prisma.clientePJ.findFirst({ where: { cnpj } })
}

export async function createClientePJ(dados: CriarClientePJInput) {
  const { razaoSocial, cnpj, nomeFantasia, inscricaoEstadual, responsavel, usuarioId, parceiroId, email } = dados

  return prisma.cliente.create({
    data: {
      email,
      usuario: { connect: { id: usuarioId } },
      ...(parceiroId ? { parceiroObj: { connect: { id: parceiroId } } } : {}),
      pj: {
        create: { razaoSocial, cnpj, nomeFantasia, inscricaoEstadual, responsavel },
      },
    },
    include: { pj: true, enderecos: true },
  })
}

export async function updateClientePJ(clienteId: string, dados: EditarClientePJInput) {
  const { razaoSocial, cnpj, nomeFantasia, inscricaoEstadual, responsavel, email, parceiroId } = dados

  return prisma.cliente.update({
    where: { id: clienteId },
    data: {
      ...(email && { email }),
      ...(parceiroId !== undefined && {
        parceiroObj: parceiroId ? { connect: { id: parceiroId } } : { disconnect: true },
      }),
      pj: {
        update: {
          ...(razaoSocial && { razaoSocial }),
          ...(cnpj && { cnpj }),
          ...(nomeFantasia !== undefined && { nomeFantasia }),
          ...(inscricaoEstadual !== undefined && { inscricaoEstadual }),
          ...(responsavel !== undefined && { responsavel }),
        },
      },
    },
    include: { pj: true, enderecos: true },
  })
}
