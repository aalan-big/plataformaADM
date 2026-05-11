import { prisma } from '../client'
import type { CriarEnderecoInput, EditarEnderecoInput } from '@startbig/schemas'

export async function findEnderecosByCliente(clienteId: string) {
  return prisma.endereco.findMany({
    where: { clienteId },
    orderBy: { criadoEm: 'asc' },
  })
}

export async function findEnderecoById(id: string) {
  return prisma.endereco.findUnique({ where: { id } })
}

export async function createEndereco(data: CriarEnderecoInput) {
  return prisma.endereco.create({ data })
}

export async function updateEndereco(id: string, data: EditarEnderecoInput) {
  return prisma.endereco.update({ where: { id }, data })
}

export async function deleteEndereco(id: string) {
  return prisma.endereco.delete({ where: { id } })
}
