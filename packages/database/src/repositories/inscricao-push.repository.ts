import { prisma } from '../client'

/**
 * Aparelhos inscritos para receber notificação push do painel.
 *
 * A identidade é o `endpoint` — a URL que o navegador do aparelho nos deu.
 * Reinscrever o mesmo device tem que ATUALIZAR a linha, nunca criar outra:
 * duas linhas com o mesmo endpoint entregariam a notificação em dobro.
 */

export async function salvarInscricaoPush(dados: {
  endpoint:   string
  p256dh:     string
  auth:       string
  usuarioId?: string | null
  descricao?: string | null
}) {
  return prisma.inscricaoPush.upsert({
    where:  { endpoint: dados.endpoint },
    create: {
      endpoint:  dados.endpoint,
      p256dh:    dados.p256dh,
      auth:      dados.auth,
      usuarioId: dados.usuarioId ?? null,
      descricao: dados.descricao ?? null,
    },
    // Reinscrição zera o contador de falhas: o aparelho acabou de provar que
    // está vivo, e carregar falha antiga faria ele ser descartado cedo demais.
    update: {
      p256dh:         dados.p256dh,
      auth:           dados.auth,
      usuarioId:      dados.usuarioId ?? null,
      descricao:      dados.descricao ?? null,
      falhasSeguidas: 0,
    },
  })
}

export async function removerInscricaoPush(endpoint: string) {
  return prisma.inscricaoPush.deleteMany({ where: { endpoint } })
}

export async function findInscricoesPush() {
  return prisma.inscricaoPush.findMany({ orderBy: { criadoEm: 'desc' } })
}

export async function findInscricaoPushByEndpoint(endpoint: string) {
  return prisma.inscricaoPush.findUnique({ where: { endpoint } })
}

export async function registrarEnvioPush(id: string) {
  return prisma.inscricaoPush.update({
    where: { id },
    data:  { ultimoEnvioEm: new Date(), falhasSeguidas: 0 },
  })
}

export async function registrarFalhaPush(id: string) {
  return prisma.inscricaoPush.update({
    where: { id },
    data:  { falhasSeguidas: { increment: 1 } },
  })
}
