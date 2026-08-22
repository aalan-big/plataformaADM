import { z } from 'zod'

/**
 * Períodos vendáveis, no vocabulário que o ERP usa na tela.
 *
 * O ERP escolhe um PERÍODO, não um plano: qual plano a licença tem já está
 * decidido no nosso banco, e é de lá que sai o preço. O contrato do ERP chama
 * este campo de `plano` por herança do documento original — por isso os
 * schemas abaixo aceitam os dois nomes.
 */
export const PERIODOS_EM_MESES = { MENSAL: 1, TRIMESTRAL: 3, ANUAL: 12 } as const
export type PeriodoRenovacao = keyof typeof PERIODOS_EM_MESES

export const periodoRenovacaoSchema = z.enum(['MENSAL', 'TRIMESTRAL', 'ANUAL'])

/**
 * Credencial do ERP nas rotas de renovação.
 *
 * `hwid` é aceito e registrado, mas NÃO é conferido — e isso é deliberado.
 * Hoje o hwid nem é verificado no `/erp/validar` (ele só é ecoado dentro do
 * token), e só existe em `licencas_sessoes` para máquina que conectou
 * recentemente: a sessão morre após 35 min sem heartbeat. Exigir que ele
 * "bata" trancaria justamente quem precisa pagar — a licença vencida, com o
 * ERP em modo somente-renovação e sessão já expirada.
 *
 * A chave de ativação é a credencial, no mesmo nível de confiança que o resto
 * do contrato do ERP já adota. E o pior que alguém de posse dela consegue
 * fazer por aqui é gerar um boleto para pagar a licença de outra pessoa.
 */
export const credencialErpSchema = z.object({
  chave: z.string().min(1),
  hwid:  z.string().optional(),
})

/** Aceita `periodo` (nome nosso) ou `plano` (nome do contrato do ERP). */
export const criarCobrancaRenovacaoSchema = credencialErpSchema
  .extend({
    metodo:  z.enum(['PIX', 'CARTAO']),
    periodo: periodoRenovacaoSchema.optional(),
    plano:   periodoRenovacaoSchema.optional(),
  })
  .refine(d => !!(d.periodo ?? d.plano), {
    message: 'Informe o período da renovação (MENSAL, TRIMESTRAL ou ANUAL).',
    path:    ['periodo'],
  })
  .transform(d => ({
    chave:   d.chave,
    hwid:    d.hwid,
    metodo:  d.metodo,
    periodo: (d.periodo ?? d.plano)!,
  }))

/** Consulta de status: a credencial viaja na query string. */
export const consultarCobrancaSchema = credencialErpSchema
