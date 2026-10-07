import { NotFoundException, BadRequestException } from '@nestjs/common'
import { prisma, MODULO_NFE, MODULO_NFCE } from '@startbig/database'
import { RecursoFocus } from '../../common/focus-nfe/focus-nfe.service'
import { decifrar } from '../../common/cripto/segredo-fiscal'

/**
 * O que os três serviços do fiscal compartilham: tipos, a tradução da resposta
 * da Focus e a busca da ficha fiscal pela licença.
 *
 * Até a F5 (07/10/2026) tudo isto morava num `FiscalService` de 1500 linhas;
 * foi dividido em onboarding, emissão e cota SEM mudar comportamento — os
 * corpos foram movidos, não reescritos.
 */

export const AMBIENTE_PRODUCAO = 1

/** Tipos de documento que esta plataforma sabe emitir hoje. */
export type TipoDocumentoEmissivel = typeof MODULO_NFE | typeof MODULO_NFCE

/**
 * Tipo de documento (que é também o identificador do módulo vendido) para o
 * caminho correspondente na Focus. O mapa existe para que a tradução aconteça
 * num lugar só: espalhada, um `'nfce'` escrito à mão em algum método mandaria
 * NFC-e pelo endpoint de NF-e sem erro de compilação.
 */
export const RECURSO_FOCUS: Record<TipoDocumentoEmissivel, RecursoFocus> = {
  [MODULO_NFE]:  'nfe',
  [MODULO_NFCE]: 'nfce',
}

/**
 * Competência ("2026-08") fechada no fuso de São Paulo.
 *
 * Se saísse de UTC, a virada do mês aconteceria às 21h do dia 31 para o cliente:
 * a nota emitida às 22h contaria no mês seguinte e o cliente veria a cota
 * renovar um dia antes do que devia.
 */
export function competenciaAtual(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year:     'numeric',
    month:    '2-digit',
  }).format(agora).slice(0, 7)
}

/**
 * O token que a emissão usa, para o ambiente vigente da ficha.
 *
 * `focusEmpresaToken` (texto, colado pelo admin ou gravado pelo envio antigo de
 * certificado) VENCE: colar um token é intenção explícita de alguém. Sem ele,
 * vale o cifrado do ambiente — o que a ativação grava (06/10/2026). Fichas
 * anteriores à ativação não têm os cifrados e seguem exatamente como antes.
 */
export function tokenDeEmissao(config: {
  ambiente: number
  focusEmpresaToken?: string | null
  focusTokenProducao?: string | null
  focusTokenHomologacao?: string | null
}): string | null {
  if (config.focusEmpresaToken) return config.focusEmpresaToken
  return decifrar(config.ambiente === AMBIENTE_PRODUCAO ? config.focusTokenProducao : config.focusTokenHomologacao)
}

/** "1" ou 1 viram 1; o que não for número vira null em vez de NaN. */
export function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

export function nomeAmbiente(ambiente: number): 'Producao' | 'Homologacao' {
  return ambiente === AMBIENTE_PRODUCAO ? 'Producao' : 'Homologacao'
}

/**
 * A Focus devolve os caminhos de PDF e XML relativos ao host dela
 * (`/arquivos/...`), e o host depende do ambiente. O ERP recebe a URL pronta.
 */
export function urlAbsolutaFocus(caminho: unknown, ambiente: number): string | null {
  if (typeof caminho !== 'string' || !caminho) return null
  if (caminho.startsWith('http')) return caminho
  const domain = ambiente === AMBIENTE_PRODUCAO
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br'
  return `${domain}${caminho}`
}

/** Resposta da Focus já normalizada para o formato que o ERP e o painel leem. */
export type ResultadoNota = {
  status:         string
  status_focus:   string
  tipoDocumento:  string
  ambiente:       number
  ambienteNome:   string
  chave_acesso:   string | null
  protocolo:      string | null
  numero:         number | null
  serie:          number | null
  url_pdf:        string | null
  url_xml:        string | null
  qrcode:         string | null
  url_consulta:   string | null
  codigo_sefaz:   number | null
  mensagem_sefaz: string | null
  erros:          unknown[] | null
}

/**
 * Traduz a resposta da Focus para o contrato que o ERP consome.
 *
 * Os nomes lidos aqui são os que a Focus documenta HOJE — `caminho_danfe`,
 * `status_sefaz`, e o protocolo dentro de `protocolo_nota_fiscal`. As grafias
 * antigas ficam como alternativa porque este mapeamento já rodou lendo campos
 * que não existiam (`caminho_danfe_pdf`, `codigo_sefaz`, `protocolo` na raiz)
 * e devolvendo `null` sem acusar nada: aceitar as duas custa um `??` e evita
 * que a próxima diferença de nome vire outro campo vazio silencioso.
 *
 * O mesmo mapeamento serve à inutilização, cuja resposta tem nomes próprios
 * (`protocolo_sefaz`, `caminho_xml` na raiz). Eles entram como alternativas
 * pelo mesmo motivo — e foi assim que o protocolo da inutilização chegou
 * nulo desde que a rota nasceu, sem ninguém acusar.
 */
export function mapResultado(data: any, ambiente: number, tipoDocumento: TipoDocumentoEmissivel): ResultadoNota {
  let status = 'erro'
  const statusFocus = data?.status || ''

  if (statusFocus === 'autorizado') {
    status = 'autorizado'
  } else if (
    statusFocus === 'processando_autorizacao' ||
    statusFocus === 'processando'
  ) {
    status = 'processando'
  } else if (statusFocus === 'cancelado') {
    status = 'cancelado'
  }

  const absoluta = (caminho: unknown) => urlAbsolutaFocus(caminho, ambiente)

  return {
    status,
    /**
     * O status cru da Focus, ao lado do normalizado.
     *
     * `denegado` e `erro_autorizacao` viram os dois "erro" acima, e são coisas
     * diferentes: denegada é uma nota que a SEFAZ registrou e recusou, e
     * reenviar não adianta. Sem este campo o ERP não teria como separar as
     * duas — e trocar o valor de `status` quebraria quem já lê os quatro.
     */
    status_focus:  statusFocus,
    tipoDocumento,
    ambiente,
    ambienteNome:  nomeAmbiente(ambiente),
    chave_acesso:  data?.chave_nfe || data?.chave || null,
    /**
     * `protocolo_sefaz` é o nome na INUTILIZAÇÃO — a única rota em que a Focus
     * chama o protocolo assim. Sem esta alternativa a inutilização voltava
     * `protocolo: null` para o ERP, e o protocolo é justamente o que o
     * contador precisa para homologar a lacuna na SEFAZ.
     */
    protocolo:     data?.protocolo || data?.numero_protocolo || data?.protocolo_nota_fiscal?.numero_protocolo || data?.protocolo_sefaz || null,
    numero:        numeroOuNulo(data?.numero),
    serie:         numeroOuNulo(data?.serie),
    url_pdf:       absoluta(data?.caminho_danfe ?? data?.caminho_danfe_pdf),
    url_xml:       absoluta(data?.caminho_xml_nota_fiscal ?? data?.caminho_xml),
    /**
     * QR Code e URL de consulta só existem em NFC-e, e sem eles o cupom não
     * vale: é o que o consumidor lê para conferir a nota no portal da SEFAZ.
     * Quem monta os dois é a Focus, a partir do CSC cadastrado na empresa —
     * por isso nunca trafegam no payload nem passam por aqui de ida.
     */
    qrcode:        data?.qrcode_url || data?.qrcode || null,
    url_consulta:  data?.url_consulta_nf || null,
    codigo_sefaz:  numeroOuNulo(data?.status_sefaz ?? data?.codigo_sefaz),
    mensagem_sefaz: data?.mensagem_sefaz || null,
    erros:         Array.isArray(data?.erros) ? data.erros : null,
  }
}

export async function getEmpresaConfig(licencaId: string) {
  const config = await buscarEmpresaConfig(licencaId)

  if (!config) {
    throw new NotFoundException({
      codigo:   'SEM_CONFIGURACAO_FISCAL',
      mensagem: 'Empresa não possui configuração fiscal ativa.',
    })
  }

  const token = tokenDeEmissao(config)
  if (!token) {
    throw new BadRequestException('Token de emissão da Focus NFe pendente de configuração.')
  }

  return { ...config, focusEmpresaToken: token }
}

/**
 * A mesma busca, sem exigir que exista.
 *
 * Serve às rotas que descrevem o estado (`/config` e `/consumo`) em vez de
 * agirem sobre ele: para elas, "este cliente ainda não foi configurado" é uma
 * resposta legítima, e transformar isso em 404 tiraria do ERP justamente a
 * informação que ele precisa mostrar na tela.
 */
export async function buscarEmpresaConfig(licencaId: string) {
  const licenca = await prisma.licenca.findUnique({
    where: { id: licencaId },
    select: { clienteId: true },
  })

  if (!licenca) {
    throw new NotFoundException({
      codigo:   'LICENCA_NAO_ENCONTRADA',
      mensagem: 'Licença não encontrada no servidor.',
    })
  }

  const config = await prisma.empresaFiscalConfig.findUnique({
    where: { clienteId: licenca.clienteId },
  })

  return config ? { ...config, clienteId: licenca.clienteId } : null
}
