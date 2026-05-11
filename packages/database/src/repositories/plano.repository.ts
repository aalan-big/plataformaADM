import { prisma } from '../client'

export async function findAllPlanos() {
  return prisma.plano.findMany({
    where:   { status: 'ATIVO' },
    orderBy: { precoMensal: 'asc' },
    select:  { id: true, nome: true, precoMensal: true, limiteUsuario: true },
  })
}

export async function findPlanoById(id: string) {
  return prisma.plano.findUnique({ where: { id } })
}
