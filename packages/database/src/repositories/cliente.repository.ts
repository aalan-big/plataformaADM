import { prisma } from '../client'

const includeAll = {
  pf: true,
  pj: true,
  enderecos: true,
}

export async function findAllClientes() {
  return prisma.cliente.findMany({
    where: { ativo: true },
    include: includeAll,
    orderBy: { criadoEm: 'desc' },
  })
}

export async function findClienteById(id: string) {
  return prisma.cliente.findUnique({
    where: { id },
    include: includeAll,
  })
}

export async function searchClientes(termo: string) {
  const t = termo.trim()
  return prisma.cliente.findMany({
    where: {
      ativo: true,
      OR: [
        { id:    { contains: t, mode: 'insensitive' } },
        { email: { contains: t, mode: 'insensitive' } },
        { pf: { nomeCompleto: { contains: t, mode: 'insensitive' } } },
        { pf: { cpf:          { contains: t, mode: 'insensitive' } } },
        { pj: { razaoSocial:  { contains: t, mode: 'insensitive' } } },
        { pj: { nomeFantasia: { contains: t, mode: 'insensitive' } } },
        { pj: { cnpj:         { contains: t, mode: 'insensitive' } } },
        { pj: { responsavel:  { contains: t, mode: 'insensitive' } } },
      ],
    },
    include: includeAll,
    orderBy: { criadoEm: 'desc' },
  })
}

export async function findClienteByEmail(email: string, excluirId?: string) {
  return prisma.cliente.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
  })
}
