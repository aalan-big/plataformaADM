import { z } from 'zod'

export const criarLicencaSchema = z.object({
  clienteId:       z.string().uuid(),
  planoId:         z.string().uuid(),
  nomeDispositivo: z.string().optional(),
  hwid:            z.string().optional(),
  dias:            z.number().int().min(1).max(365).optional(),
})

export const renovarLicencaSchema = z.object({
  meses: z.number().int().min(1).max(24),
})

/**
 * Cortesia em DIAS, e nao em meses como a renovacao. Sao coisas diferentes:
 * renovar e o registro de uma venda; cortesia e um presente com prazo curto
 * ("te dou mais 5 dias pra decidir"). Por isso o minimo aqui e 1 dia, e o teto
 * de 90 existe pra que "cortesia" nao vire assinatura gratuita por descuido —
 * quem precisa de mais que um trimestre de graca esta renovando, nao cortejando.
 */
export const cortesiaLicencaSchema = z.object({
  dias:       z.number().int().min(1).max(90),
  observacao: z.string().trim().max(200).optional(),
})

export const adicionarExtraSchema = z.object({
  extras: z.number().int().min(1).max(100),
})

export const conectarSchema = z.object({
  chave: z.string().min(1),
  hwid:  z.string().optional(),
})

export const desconectarSchema = z.object({
  chave: z.string().min(1),
  hwid:  z.string().optional(),
})

export const heartbeatSchema = z.object({
  licencaId:     z.string().uuid(),
  hwid:          z.string().optional(),
  totalUsuarios: z.number().int().min(0).optional(),
})

export const validarSchema = z.object({
  chave: z.string().min(1),
  hwid:  z.string().optional(),
})

export const gerarCobrancaSchema = z.object({
  licencaId: z.string().uuid(),
  meses:     z.number().int().min(1).max(12),
  /**
   * Cobrar por OUTRO plano que não o atual da licença. Usado na troca de plano
   * paga: a licença só muda de plano quando o pagamento cai, não antes.
   * Ausente = cobra o plano que a licença já tem.
   */
  planoId:   z.string().uuid().optional(),
})

export const confirmarPagamentoSchema = z.object({
  licencaId:  z.string().uuid(),
  meses:      z.number().int().min(1).max(24),
  valor:      z.number().positive(),
  observacao: z.string().optional(),
})
