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

export const adicionarExtraSchema = z.object({
  extras: z.number().int().min(1).max(100),
})

export const conectarSchema = z.object({
  chave: z.string().min(1),
  hwid:  z.string().optional(),
})

export const desconectarSchema = z.object({
  chave: z.string().min(1),
})

export const heartbeatSchema = z.object({
  licencaId: z.string().uuid(),
})

export const validarSchema = z.object({
  chave: z.string().min(1),
  hwid:  z.string().optional(),
})

export const gerarCobrancaSchema = z.object({
  licencaId: z.string().uuid(),
  meses:     z.number().int().min(1).max(12),
})

export const confirmarPagamentoSchema = z.object({
  licencaId:  z.string().uuid(),
  meses:      z.number().int().min(1).max(24),
  valor:      z.number().positive(),
  observacao: z.string().optional(),
})
