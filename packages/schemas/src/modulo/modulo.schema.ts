import { z } from 'zod'

/**
 * Concessão de um módulo avulso a uma licença.
 *
 * A regra que mais importa aqui é a do `refine` no fim: cortesia SEM data de
 * vencimento não é cortesia, é gratuidade permanente concedida por esquecimento.
 * Como ninguém revisa uma lista de cortesias antigas, o prazo tem que ser
 * exigido no momento em que a decisão é tomada — depois já virou receita perdida
 * que ninguém enxerga.
 */
export const concederModuloExtraSchema = z.object({
  identificador: z.string().trim().min(1, 'Escolha um módulo.'),

  cortesia: z.boolean().optional().default(false),

  /// ISO 8601. Nulo = acompanha o ciclo da licença.
  dataVencimento: z.string().datetime({ offset: true }).optional().nullable()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').optional().nullable()),

  valorCobrado: z.number().min(0).optional().nullable(),
  cotaMensal:   z.number().int().min(0).optional().nullable(),
  observacao:   z.string().trim().max(200).optional().nullable(),
}).refine(d => !d.cortesia || !!d.dataVencimento, {
  message: 'Cortesia exige data de vencimento — sem prazo ela vira gratuidade permanente.',
  path:    ['dataVencimento'],
}).refine(d => !d.cortesia || d.valorCobrado == null || d.valorCobrado === 0, {
  message: 'Cortesia não pode ter valor cobrado.',
  path:    ['valorCobrado'],
})

export type ConcederModuloExtraInput = z.infer<typeof concederModuloExtraSchema>

/**
 * Edição de um módulo do catálogo.
 *
 * `identificador` NÃO está aqui, e a ausência é a regra: ele viaja dentro do JWT
 * das licenças e é comparado pelo ERP. Renomear invalidaria em silêncio todo
 * token já emitido, que seguiria carregando o nome antigo por até 7 dias — e o
 * sintoma seria menu sumindo na máquina do cliente, sem erro em lugar nenhum.
 */
export const editarModuloSchema = z.object({
  nome:      z.string().trim().min(2, 'Nome muito curto.').optional(),
  descricao: z.string().trim().max(300).optional().nullable(),
  icone:     z.string().trim().max(40).optional().nullable(),
  ativo:     z.boolean().optional(),
  ordem:     z.number().int().min(0).optional(),
  // Nulo explícito = tirar de venda avulsa. Omitido = não mexe.
  precoMensal: z.number().min(0).optional().nullable(),
})

export type EditarModuloInput = z.infer<typeof editarModuloSchema>
