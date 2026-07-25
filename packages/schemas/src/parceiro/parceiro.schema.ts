import { z } from 'zod'

export const TIPOS_COMISSAO = ['FIXO_MENSAL', 'PERCENTUAL'] as const

/**
 * Código público de indicação. Curto e sem ambiguidade visual — é digitado por
 * pessoas e às vezes ditado por telefone.
 *
 * A normalização para maiúsculas fica no service, não num `.transform()` aqui:
 * transform muda o tipo inferido do schema e vaza para todo mundo que consome
 * o parse. Validar aqui, normalizar lá, mantém os dois papéis separados.
 */
const codigoParceiro = z
  .string()
  .trim()
  .min(3, 'O código precisa de pelo menos 3 caracteres.')
  .max(20, 'O código deve ter no máximo 20 caracteres.')
  .regex(/^[A-Za-z0-9-]+$/, 'Use apenas letras, números e hífen.')

export const criarParceiroSchema = z.object({
  codigo:             codigoParceiro,
  nomeParceiro:       z.string().trim().min(2),
  documento:          z.string().trim().optional(),
  email:              z.string().email('E-mail inválido.').optional(),
  contatoCelular:     z.string().trim().optional(),
  cidadeBase:         z.string().trim().optional(),
  tipoComissao:       z.enum(TIPOS_COMISSAO).default('FIXO_MENSAL'),
  valorComissaoFixa:  z.number().min(0).optional(),
  comissaoPercentual: z.number().min(0).max(100).optional(),
  observacoes:        z.string().trim().optional(),
})
  // Regra de comissão precisa ser utilizável: sem o parâmetro do tipo escolhido,
  // o parceiro seria cadastrado e nunca geraria repasse nenhum, em silêncio.
  .refine(
    d => d.tipoComissao !== 'FIXO_MENSAL' || (d.valorComissaoFixa ?? 0) > 0,
    { path: ['valorComissaoFixa'], message: 'Informe o valor fixo por mês (ex.: 30) para comissão FIXO_MENSAL.' },
  )
  .refine(
    d => d.tipoComissao !== 'PERCENTUAL' || (d.comissaoPercentual ?? 0) > 0,
    { path: ['comissaoPercentual'], message: 'Informe o percentual (ex.: 20) para comissão PERCENTUAL.' },
  )

export const editarParceiroSchema = z.object({
  codigo:             codigoParceiro.optional(),
  nomeParceiro:       z.string().trim().min(2).optional(),
  documento:          z.string().trim().nullable().optional(),
  email:              z.string().email('E-mail inválido.').nullable().optional(),
  contatoCelular:     z.string().trim().nullable().optional(),
  cidadeBase:         z.string().trim().nullable().optional(),
  status:             z.enum(['ATIVO', 'INATIVO']).optional(),
  tipoComissao:       z.enum(TIPOS_COMISSAO).optional(),
  valorComissaoFixa:  z.number().min(0).nullable().optional(),
  comissaoPercentual: z.number().min(0).max(100).nullable().optional(),
  observacoes:        z.string().trim().nullable().optional(),
})

export const vincularClienteSchema = z.object({
  clienteId:  z.string().uuid('clienteId inválido.'),
  /** null desvincula o cliente do parceiro atual. */
  parceiroId: z.string().uuid('parceiroId inválido.').nullable(),
})

export const pagarComissoesSchema = z.object({
  comissaoIds:         z.array(z.string().uuid()).min(1, 'Selecione ao menos uma comissão.'),
  referenciaPagamento: z.string().trim().max(120).optional(),
  observacao:          z.string().trim().max(300).optional(),
})

export type CriarParceiroInput  = z.infer<typeof criarParceiroSchema>
export type EditarParceiroInput = z.infer<typeof editarParceiroSchema>
