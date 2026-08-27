import { prisma } from '../client'

/**
 * Competência ("2026-08") fechada no fuso de São Paulo.
 *
 * Em UTC a virada do mês cairia às 21h do dia 31: a nota emitida às 22h contaria
 * no mês seguinte e a cota do cliente renovaria um dia antes do que devia.
 */
export function competenciaFiscalAtual(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year:     'numeric',
    month:    '2-digit',
  }).format(agora).slice(0, 7)
}

export async function contarEmissaoLogAntigos(dias: number) {
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
  return prisma.emissaoLog.count({ where: { criadoEm: { lt: limite } } })
}

/**
 * Poda a trilha de suporte.
 *
 * Só o log some — `consumo_fiscal` nunca é podado. São coisas diferentes de
 * propósito: a trilha serve para investigar um chamado recente e envelhece mal
 * (é o único lugar do sistema com `ref` de notas de terceiros), enquanto o
 * contador é histórico de faturamento e tem que durar. Apagar os dois juntos
 * seria destruir a base de uma cobrança para limpar um log de suporte.
 */
export async function podarEmissaoLog(dias: number) {
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
  return prisma.emissaoLog.deleteMany({ where: { criadoEm: { lt: limite } } })
}

/**
 * Concede notas avulsas para o mês corrente de uma licença.
 *
 * Só produção: homologação não tem teto, então não faz sentido comprar folga
 * nela. O extra é sempre da competência atual e morre na virada do mês — quem
 * comprar um pacote em agosto não carrega o saldo para setembro, senão a cota
 * mensal deixaria de ser mensal.
 */
export async function concederNotasExtras(licencaId: string, quantidade: number, tipoDocumento: string) {
  const competencia = competenciaFiscalAtual()
  return prisma.consumoFiscal.upsert({
    where:  { licencaId_competencia_ambiente_tipoDocumento: { licencaId, competencia, ambiente: 1, tipoDocumento } },
    update: { cotaExtra: { increment: quantidade } },
    create: { licencaId, competencia, ambiente: 1, tipoDocumento, cotaExtra: quantidade },
  })
}
