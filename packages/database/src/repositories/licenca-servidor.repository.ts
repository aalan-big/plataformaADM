import type { Prisma } from '@prisma/client'
import { prisma } from '../client'

/**
 * Servidor da licença e os servidores antigos que perderam a vaga.
 *
 * A falta de sessão não prova nada — o cron apaga sessão sem heartbeat há
 * 35 min, e uma loja sem internet por 40 min ficaria sem nenhuma. O que separa
 * "caiu a internet" de "a licença foi transferida" é esta lista: só entra nela o
 * servidor antigo, no momento em que o dono entra na conta por outro computador.
 */

/** Eventos do histórico que contam como uma troca de computador (antiabuso). */
export const TIPOS_TROCA_DE_COMPUTADOR = ['TROCA_SERVIDOR', 'TROCA_DISPOSITIVO']

/** Evento que o suporte grava ao liberar trocas: zera a contagem a partir dali. */
export const TIPO_LIBERACAO_TROCA = 'LIBERACAO_TROCA'

export async function hwidEstaRevogado(licencaId: string, hwid: string) {
  const linha = await prisma.licencaHwidRevogado.findUnique({
    where: { licencaId_hwid: { licencaId, hwid } },
  })
  return !!linha
}

/**
 * Grava `hwidNovo` como servidor da licença, num passo só.
 *
 * Com `hwidAntigo` (troca de servidor): ele vai para a lista de revogados e a
 * sessão dele é apagada, liberando a vaga. Só o servidor antigo — os caixas são
 * os mesmos computadores e continuam na loja nova. `hwidNovo` sai da lista, se
 * estava nela: o dono decidiu voltar para aquele computador.
 */
export async function assumirServidorDaLicenca(licencaId: string, hwidNovo: string, hwidAntigo: string | null) {
  const operacoes: Prisma.PrismaPromise<unknown>[] = [
    prisma.licencaHwidRevogado.deleteMany({ where: { licencaId, hwid: hwidNovo } }),
    prisma.licenca.update({ where: { id: licencaId }, data: { hwidServidor: hwidNovo } }),
  ]

  if (hwidAntigo && hwidAntigo !== hwidNovo) {
    operacoes.push(
      prisma.licencaHwidRevogado.upsert({
        where:  { licencaId_hwid: { licencaId, hwid: hwidAntigo } },
        update: { revogadoEm: new Date() },
        create: { licencaId, hwid: hwidAntigo },
      }),
      prisma.licencaSessao.deleteMany({ where: { licencaId, hwid: hwidAntigo } }),
    )
  }

  return prisma.$transaction(operacoes)
}

/**
 * Quantas trocas de computador a licença fez desde `inicioJanela` — ou desde a
 * última liberação do suporte, se ela for mais recente.
 */
export async function contarTrocasDeComputador(licencaId: string, inicioJanela: Date) {
  const liberacao = await prisma.licencaHistorico.findFirst({
    where:   { licencaId, tipo: TIPO_LIBERACAO_TROCA },
    orderBy: { criadoEm: 'desc' },
  })

  const desde = liberacao && liberacao.criadoEm > inicioJanela ? liberacao.criadoEm : inicioJanela

  return prisma.licencaHistorico.count({
    where: { licencaId, tipo: { in: TIPOS_TROCA_DE_COMPUTADOR }, criadoEm: { gt: desde } },
  })
}
