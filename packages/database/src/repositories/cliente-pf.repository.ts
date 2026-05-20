import { prisma } from '../client'
import type { CriarClientePFInput, EditarClientePFInput } from '@startbig/schemas'

export async function findClientePFByCpf(cpf: string) {
  return prisma.clientePF.findFirst({ where: { cpf } })
}

export async function createClientePF(dados: CriarClientePFInput) {
  const { nomeCompleto, cpf, rg, dataNascimento, usuarioId, parceiroId, email } = dados

  return prisma.cliente.create({
    data: {
      tipo:    'PF',
      email:   email as string,
      usuario: { connect: { id: usuarioId } },
      ...(parceiroId ? { parceiroObj: { connect: { id: parceiroId } } } : {}),
      pf: {
        create: {
          nomeCompleto,
          cpf,
          rg,
          dataNascimento: dataNascimento ? new Date(dataNascimento) : undefined,
        },
      },
    },
    include: { pf: true, enderecos: true },
  })
}

export async function updateClientePF(clienteId: string, dados: EditarClientePFInput) {
  const { nomeCompleto, cpf, rg, dataNascimento, ...base } = dados

  return prisma.cliente.update({
    where: { id: clienteId },
    data: {
      ...base,
      pf: {
        update: {
          ...(nomeCompleto && { nomeCompleto }),
          ...(cpf && { cpf }),
          ...(rg !== undefined && { rg }),
          ...(dataNascimento && { dataNascimento: new Date(dataNascimento) }),
        },
      },
    },
    include: { pf: true, enderecos: true },
  })
}
