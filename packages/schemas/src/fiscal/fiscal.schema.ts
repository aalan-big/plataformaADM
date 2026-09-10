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

  /**
   * O id desta empresa DENTRO da Focus, colado do painel dela.
   *
   * Não é segredo — é um identificador, e ele volta na leitura do cliente. Está
   * aqui porque o upload de certificado do ERP precisa dele: `PUT /v2/empresas/
   * {id}` é o que grava o .pfx na emissora, e sem o id a rota não tem o que
   * atualizar. Até este campo existir, o cadastro do lojista ficava parado em
   * `VALIDADO_LOCAL` e ninguém tinha onde informar o número.
   *
   * Ausente significa "não mexe", como no token. String vazia é intenção
   * explícita de limpar — o painel sempre manda o valor que carregou, então
   * apagar o campo é o admin dizendo que quer apagar.
   */
  focusEmpresaId: z.string().trim().optional(),

  removerToken: z.boolean().optional(),

  /**
   * Marcador de que o CSC desta empresa já está cadastrado na Focus.
   *
   * É um "sim/não" para o suporte, não o segredo: o CSC fica no cadastro da
   * empresa na Focus, junto do certificado, e a plataforma não o transporta nem
   * o guarda. A Focus pede o código uma única vez por empresa e monta sozinha o
   * hash do QR Code — ele nunca precisou viajar por nota.
   *
   * O CSC é por ambiente: o de homologação não vale em produção. Por isso
   * `salvarConfiguracaoFiscal` derruba este marcador quando o ambiente muda.
   */
  cscConfigurado: z.boolean().optional(),
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

/**
 * Chave de idempotência enviada pelo ERP no cabeçalho `X-Idempotency-Key`.
 *
 * Limites frouxos porque quem gera é o ERP e o formato é escolha dele — um UUID,
 * o id da venda, um hash. O que importa é caber num índice e não ser vazia.
 */
export const chaveIdempotenciaSchema = z.string()
  .trim()
  .min(8,   { message: 'A chave de idempotência deve ter ao menos 8 caracteres.' })
  .max(200, { message: 'A chave de idempotência deve ter no máximo 200 caracteres.' })

/**
 * Corpo da emissão de uma nota (NF-e ou NFC-e).
 *
 * O `payload` passa INTEIRO para a Focus. Esta validação valida só o que a
 * plataforma usa — a `ref`, que vira chave de idempotência e caminho de URL, e
 * a existência de itens — e deliberadamente não tenta conferir os campos
 * fiscais.
 *
 * A versão anterior listava campo a campo (`natureza_operacao`, `emitente`,
 * `destinatario`, `items`, `totais`) e, como todo objeto Zod, DESCARTAVA o que
 * não estivesse na lista. Na prática isso apagava `icms_situacao_tributaria`,
 * `presenca_comprador`, `modalidade_frete`, `formas_pagamento` e o resto do que
 * a SEFAZ exige, antes de a nota sair daqui: a Focus recusava por falta de
 * campo obrigatório e o motivo apontava para o payload de quem não tinha tirado
 * nada. Quem conhece o conjunto completo de campos é a Focus, e é lá que a
 * validação fiscal deve acontecer.
 *
 * `looseObject` em vez de `object` é justamente isso: campo desconhecido passa.
 */
export const emitirNotaSchema = z.object({
  ref: refNotaSchema,
  payload: z.looseObject({
    // Nota sem item nenhum é certamente um erro do chamador, e é a única coisa
    // que dá para afirmar aqui sem conhecer o regime tributário da operação.
    items: z.array(z.looseObject({})).min(1, 'A nota deve conter pelo menos um item.'),
  }),
})

export const cancelarNotaSchema = z.object({
  ref: refNotaSchema,
  // 15 caracteres é exigência da SEFAZ, não escolha nossa.
  justificativa: z.string().trim().min(15, 'A justificativa de cancelamento deve conter no mínimo 15 caracteres.'),
})

/**
 * Inutilização de uma faixa de numeração.
 *
 * Sem `ref` e sem `cnpj`: a Focus identifica o evento pela faixa, e o CNPJ sai
 * da configuração fiscal da licença — aceitar um do corpo deixaria um ERP
 * adulterado inutilizar numeração de outro emitente, que é evento registrado na
 * SEFAZ e que ninguém desfaz.
 */
export const inutilizarSchema = z.looseObject({
  serie:          z.coerce.number().int().min(0, 'Série inválida.').max(999, 'Série inválida.'),
  numero_inicial: z.coerce.number().int().min(1, 'O número inicial deve ser maior que zero.'),
  numero_final:   z.coerce.number().int().min(1, 'O número final deve ser maior que zero.'),
  justificativa:  z.string().trim().min(15, 'A justificativa de inutilização deve conter no mínimo 15 caracteres.'),

  /**
   * O ano da faixa. NÃO consta do schema publicado da Focus — mas o evento de
   * inutilização da SEFAZ tem ano, e quem não o informa fica dependendo de a
   * Focus assumir o ano corrente. Isso erra exatamente uma vez por ano, no pior
   * lugar possível: inutilizar em janeiro uma faixa de dezembro registraria o
   * evento no ano errado, e evento de inutilização a SEFAZ não desfaz.
   *
   * Por isso é aceito e repassado como veio, sem transformação: se a Focus o
   * entender, a faixa vai para o ano certo; se ignorar, nada muda. O objeto é
   * `looseObject` pela mesma razão — campo que a Focus passe a aceitar amanhã
   * não pode ser descartado aqui em silêncio, que foi o defeito do schema de
   * emissão.
   */
  ano: z.union([z.string(), z.number()]).optional(),
}).refine(d => d.numero_final >= d.numero_inicial, {
  message: 'O número final não pode ser menor que o inicial.',
  path:    ['numero_final'],
})

/**
 * Certificado A1 chegando do ERP para ser cadastrado na emissora.
 *
 * O ERP nunca fala com a Focus: ele confere o arquivo na máquina do lojista
 * (senha e validade) e manda para cá, porque a conta na Focus é nossa. Enquanto
 * esta rota não existiu, o cadastro do lojista ficava `VALIDADO_LOCAL` — arquivo
 * conferido aqui, nunca entregue lá — e a primeira emissão era quem contava a
 * novidade.
 *
 * `senha` NÃO leva `.trim()`. Senha de certificado pode legitimamente começar ou
 * terminar com espaço, e aparar em silêncio produziria o pior desfecho possível:
 * a Focus recusa por senha errada, e o lojista jura que digitou a certa — porque
 * digitou.
 *
 * Nem a senha nem o arquivo podem ir para log em lugar nenhum deste caminho.
 */
export const enviarCertificadoSchema = z.object({
  arquivo_base64: z.string()
    .trim()
    .min(1, 'O arquivo do certificado é obrigatório.')
    // Um .pfx A1 tem alguns KB; em base64 raramente passa de 15 mil caracteres.
    // O teto existe para um corpo absurdo não atravessar a API até a Focus.
    .max(200_000, 'Arquivo de certificado acima do tamanho aceito.'),

  senha: z.string().min(1, 'A senha do certificado é obrigatória.'),
})
