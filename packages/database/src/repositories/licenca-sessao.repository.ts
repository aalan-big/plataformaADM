import { prisma } from '../client'

export async function upsertLicencaSessao(licencaId: string, hwid: string) {
  return prisma.licencaSessao.upsert({
    where: {
      licencaId_hwid: {
        licencaId,
        hwid,
      },
    },
    update: {
      ultimoHeartbeat: new Date(),
    },
    create: {
      licencaId,
      hwid,
    },
  })
}

export async function countSessoesAtivas(licencaId: string) {
  return prisma.licencaSessao.count({
    where: {
      licencaId,
    },
  })
}

export async function deletarSessoesInativas(minutosOffline: number) {
  const limite = new Date()
  limite.setMinutes(limite.getMinutes() - minutosOffline)

  // Acha as sessões que vão morrer para sincronizar a licença depois
  const morrendo = await prisma.licencaSessao.findMany({
    where: { ultimoHeartbeat: { lt: limite } },
    select: { licencaId: true },
  })

  if (morrendo.length === 0) return { count: 0 }

  const result = await prisma.licencaSessao.deleteMany({
    where: { ultimoHeartbeat: { lt: limite } },
  })

  // Re-sincroniza o totalUsuarios das licenças afetadas
  const licencasAfetadas = [...new Set(morrendo.map(m => m.licencaId))]
  for (const licId of licencasAfetadas) {
    const restantes = await prisma.licencaSessao.count({ where: { licencaId: licId } })
    await prisma.licenca.update({
      where: { id: licId },
      data: { totalUsuarios: restantes }
    })
  }

  return result
}

export async function deletarSessao(licencaId: string, hwid: string) {
  return prisma.licencaSessao.deleteMany({
    where: {
      licencaId,
      hwid,
    },
  })
}

export async function deletarTodasSessoesDaLicenca(licencaId: string) {
  return prisma.licencaSessao.deleteMany({
    where: {
      licencaId,
    },
  })
}
