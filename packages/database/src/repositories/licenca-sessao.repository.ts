import { prisma } from '../client'

export async function upsertLicencaSessao(licencaId: string, hwid: string, nomeComputador?: string) {
  return prisma.licencaSessao.upsert({
    where: {
      licencaId_hwid: {
        licencaId,
        hwid,
      },
    },
    update: {
      ultimoHeartbeat: new Date(),
      // Só sobrescreve quando veio: o heartbeat não manda o nome e não pode apagá-lo.
      ...(nomeComputador ? { nomeComputador } : {}),
    },
    create: {
      licencaId,
      hwid,
      nomeComputador: nomeComputador ?? null,
    },
  })
}

export async function findLicencaSessao(licencaId: string, hwid: string) {
  return prisma.licencaSessao.findUnique({
    where: { licencaId_hwid: { licencaId, hwid } },
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

/**
 * Derruba as `quantidade` sessões com heartbeat mais antigo.
 *
 * É o que um login autenticado faz quando a licença está cheia: libera só a
 * vaga que falta, em vez de derrubar a loja inteira — o caixa aberto naquele
 * momento continua vendendo. A mais antiga é a que mais provavelmente já
 * morreu (máquina desligada, sistema reinstalado).
 */
export async function deletarSessoesMaisAntigas(licencaId: string, quantidade: number) {
  if (quantidade <= 0) return { count: 0 }

  const alvos = await prisma.licencaSessao.findMany({
    where:   { licencaId },
    orderBy: { ultimoHeartbeat: 'asc' },
    take:    quantidade,
    select:  { id: true },
  })

  return prisma.licencaSessao.deleteMany({
    where: { id: { in: alvos.map(a => a.id) } },
  })
}
