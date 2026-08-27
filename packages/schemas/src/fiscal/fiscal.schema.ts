import { z } from 'zod'
import { validarCnpj } from '../core/documento.validators'

/**
 * Configuração fiscal de um emitente (painel administrativo).
 *
 * `focusEmpresaToken` é opcional de propósito: o painel não recebe mais o token
 * de volta ao carregar o cliente, então o campo chega vazio quando o admin
 * editou só a razão social. Vazio aqui significa "mantém o que já está gravado",
 * nunca "apaga" — apagar por omissão derrubaria a emissão do cliente sem que
 * ninguém tivesse pedido isso. Para remover de verdade existe `removerToken`.
 */
export const configuracaoFiscalSchema = z.object({
  cnpj: z.string()
    .transform(s => s.replace(/\D/g, ''))
    .refine(validarCnpj, { message: 'CNPJ inválido' }),

  razaoSocial: z.string().trim().min(1, { message: 'Razão social é obrigatória' }),

  inscricaoEstadual: z.string().trim().optional().nullable()
    .transform(s => (s && s.length > 0 ? s : null)),

  // 1 = Produção, 2 = Homologação. Sem outros valores: um número solto aqui
  // decide se a nota vai para a SEFAZ de verdade ou para o ambiente de teste.
  ambiente: z.coerce.number().int().refine(n => n === 1 || n === 2, {
    message: 'Ambiente deve ser 1 (Produção) ou 2 (Homologação)',
  }),

  focusEmpresaToken: z.string().trim().min(1).optional(),

  removerToken: z.boolean().optional(),
})

export type ConfiguracaoFiscalInput = z.infer<typeof configuracaoFiscalSchema>

/**
 * Referência de uma nota no nosso lado, usada como chave de idempotência na
 * Focus NFe e interpolada na URL da chamada.
 *
 * O conjunto de caracteres é restrito porque esta string vira caminho e query
 * string: uma `ref` com "/" ou "?" muda a rota chamada lá. O `encodeURIComponent`
 * na hora de montar a URL continua sendo obrigatório — esta validação é a
 * primeira das duas barreiras, não a única.
 */
export const refNotaSchema = z.string()
  .trim()
  .min(1, { message: 'A referência (ref) é obrigatória.' })
  .max(50, { message: 'A referência (ref) deve ter no máximo 50 caracteres.' })
  .regex(/^[A-Za-z0-9._-]+$/, {
    message: 'A referência (ref) aceita apenas letras, números, ponto, hífen e underline.',
  })
