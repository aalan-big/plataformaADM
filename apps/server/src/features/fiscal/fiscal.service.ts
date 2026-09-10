import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common'
import { prisma, concederNotasExtras, resolverCotaModulo, MODULO_NFE, MODULO_NFCE } from '@startbig/database'
import { FocusNfeService, RecursoFocus } from '../../common/focus-nfe/focus-nfe.service'

const AMBIENTE_PRODUCAO = 1

/** Tipos de documento que esta plataforma sabe emitir hoje. */
export type TipoDocumentoEmissivel = typeof MODULO_NFE | typeof MODULO_NFCE

/**
 * Tipo de documento (que é também o identificador do módulo vendido) para o
 * caminho correspondente na Focus. O mapa existe para que a tradução aconteça
 * num lugar só: espalhada, um `'nfce'` escrito à mão em algum método mandaria
 * NFC-e pelo endpoint de NF-e sem erro de compilação.
 */
const RECURSO_FOCUS: Record<TipoDocumentoEmissivel, RecursoFocus> = {
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
function competenciaAtual(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year:     'numeric',
    month:    '2-digit',
  }).format(agora).slice(0, 7)
}

/** "1" ou 1 viram 1; o que não for número vira null em vez de NaN. */
function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function nomeAmbiente(ambiente: number): 'Producao' | 'Homologacao' {
  return ambiente === AMBIENTE_PRODUCAO ? 'Producao' : 'Homologacao'
}

/** Resposta da Focus já normalizada para o formato que o ERP e o painel leem. */
type ResultadoNota = {
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

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name)

  constructor(private readonly focusNfeService: FocusNfeService) {}

  /**
   * Traduz a resposta da Focus para o contrato que o ERP consome.
   *
   * Os nomes lidos aqui são os que a Focus documenta HOJE — `caminho_danfe`,
   * `status_sefaz`, e o protocolo dentro de `protocolo_nota_fiscal`. As grafias
   * antigas ficam como alternativa porque este mapeamento já rodou lendo campos
   * que não existiam (`caminho_danfe_pdf`, `codigo_sefaz`, `protocolo` na raiz)
   * e devolvendo `null` sem acusar nada: aceitar as duas custa um `??` e evita
   * que a próxima diferença de nome vire outro campo vazio silencioso.
   */
  private mapResultado(data: any, ambiente: number, tipoDocumento: TipoDocumentoEmissivel): ResultadoNota {
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

    const domain = ambiente === AMBIENTE_PRODUCAO
      ? 'https://api.focusnfe.com.br'
      : 'https://homologacao.focusnfe.com.br'

    const absoluta = (caminho: unknown): string | null => {
      if (typeof caminho !== 'string' || !caminho) return null
      return caminho.startsWith('http') ? caminho : `${domain}${caminho}`
    }

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
      protocolo:     data?.protocolo || data?.numero_protocolo || data?.protocolo_nota_fiscal?.numero_protocolo || null,
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

  private async getEmpresaConfig(licencaId: string) {
    const config = await this.buscarEmpresaConfig(licencaId)

    if (!config) {
      throw new NotFoundException('Empresa não possui configuração fiscal ativa.')
    }

    if (!config.focusEmpresaToken) {
      throw new BadRequestException('Token de emissão da Focus NFe pendente de configuração.')
    }

    return { ...config, focusEmpresaToken: config.focusEmpresaToken }
  }

  /**
   * A mesma busca, sem exigir que exista.
   *
   * Serve às rotas que descrevem o estado (`/config` e `/consumo`) em vez de
   * agirem sobre ele: para elas, "este cliente ainda não foi configurado" é uma
   * resposta legítima, e transformar isso em 404 tiraria do ERP justamente a
   * informação que ele precisa mostrar na tela.
   */
  private async buscarEmpresaConfig(licencaId: string) {
    const licenca = await prisma.licenca.findUnique({
      where: { id: licencaId },
      select: { clienteId: true },
    })

    if (!licenca) {
      throw new NotFoundException('Licença não encontrada no servidor.')
    }

    const config = await prisma.empresaFiscalConfig.findUnique({
      where: { clienteId: licenca.clienteId },
    })

    return config ? { ...config, clienteId: licenca.clienteId } : null
  }

  /**
   * O que o ERP pode mostrar na tela fiscal antes de tentar emitir.
   *
   * Existe porque o ambiente é decidido AQUI, na configuração do cliente, e o
   * ERP não tem como saber qual é. Sem esta rota, a tela dele só poderia exibir
   * uma chave local — que ficaria dizendo "Homologação" enquanto a plataforma
   * emite em produção. Nenhum segredo sai: nem o token da Focus, nem o CSC, que
   * a plataforma nem guarda.
   */
  async configFiscal(licencaId: string) {
    const config = await this.buscarEmpresaConfig(licencaId)

    if (!config) {
      return {
        configurado:       false,
        cnpj:              null,
        razaoSocial:       null,
        inscricaoEstadual: null,
        ambiente:          null,
        ambienteNome:      null,
        tokenConfigurado:  false,
        cscConfigurado:    false,
        certificadoStatus: null,
        certificadoVencimento: null,
        pendencias:        ['Nenhuma configuração fiscal vinculada a esta licença.'],
      }
    }

    /**
     * A lista do que impede a emissão, pronta para a tela.
     *
     * O ERP poderia deduzir isso dos campos, mas cada integração deduziria à sua
     * maneira e a mensagem no balcão seria diferente em cada loja.
     */
    const pendencias: string[] = []
    if (!config.focusEmpresaToken)          pendencias.push('Token de emissão da Focus NFe não configurado.')
    if (!config.cscConfigurado)             pendencias.push('CSC não cadastrado na Focus para este ambiente — a NFC-e sairá sem QR Code.')
    if (config.certificadoStatus === 'VENCIDO') pendencias.push('Certificado digital vencido.')
    if (config.certificadoStatus === 'AUSENTE') pendencias.push('Certificado digital não informado.')

    return {
      configurado:       true,
      cnpj:              config.cnpj,
      razaoSocial:       config.razaoSocial,
      inscricaoEstadual: config.inscricaoEstadual,
      ambiente:          config.ambiente,
      ambienteNome:      nomeAmbiente(config.ambiente),
      tokenConfigurado:  !!config.focusEmpresaToken,
      cscConfigurado:    config.cscConfigurado,
      certificadoStatus: config.certificadoStatus,
      certificadoVencimento: config.certificadoVencimento,
      pendencias,
    }
  }

  /**
   * Recebe o certificado A1 do ERP e o entrega ao cadastro da empresa na Focus.
   *
   * É a peça que faltava do onboarding fiscal. Sem ela o ERP conferia o arquivo
   * na máquina do lojista — senha e validade — e não tinha para onde mandá-lo:
   * gravava `VALIDADO_LOCAL` e dizia na tela que o certificado não havia chegado
   * à emissora. Ele estava certo.
   *
   * Os códigos de status aqui são CONTRATO, não decoração. O ERP separa três
   * desfechos e reage diferente a cada um:
   *
   *   404/405/501 → "a plataforma ainda não recebe certificado". O cadastro fica
   *                 `VALIDADO_LOCAL` e o lojista NÃO é mandado procurar defeito
   *                 no arquivo dele. É o slot certo para o que falta do NOSSO
   *                 lado.
   *   demais 4xx  → recusa explícita. A `message` daqui aparece para o lojista.
   *   2xx         → `CONECTADO_NUVEM`, e a tela passa a dizer "Conectado".
   *
   * Por isso token da conta ausente e empresa sem `focusEmpresaId` saem como 501
   * e não como 500: os dois são configuração nossa pendente. Um 500 viraria
   * "a plataforma recusou o seu certificado", que é acusar o cliente de um
   * problema que é nosso.
   */
  async enviarCertificado(licencaId: string, arquivoBase64: string, senha: string) {
    const config = await this.buscarEmpresaConfig(licencaId)

    if (!config) {
      throw new NotFoundException('Nenhuma configuração fiscal vinculada a esta licença.')
    }

    /**
     * O token da CONTA na Focus (o "token de parceiro"), não o da empresa.
     *
     * Fica em variável de ambiente e não no banco porque vale para todos os
     * clientes: é a credencial do painel, a mesma que cria e altera qualquer
     * empresa da nossa conta. Guardá-la por cliente seria N cópias do mesmo
     * segredo esperando divergir.
     *
     * DOIS NOMES ACEITOS, e isso é deliberado. `FOCUS_NFE_PARTNER_TOKEN` é o
     * nome que a Focus usa e o que está no `.env` da VPS; `FOCUS_CONTA_TOKEN`
     * foi o nome com que esta rota nasceu. Aceitar os dois custa uma linha e
     * mata um modo de falha caro: com o nome trocado, o token está presente e
     * correto e mesmo assim a rota devolve 501 — indistinguível de "a
     * plataforma não foi configurada". O lojista lê "ainda não recebemos
     * certificado" e ninguém suspeita do `.env`.
     *
     * Ausente NÃO derruba o boot de propósito — `validarSegredosProducao` não a
     * exige. Faltar aqui desabilita o upload de certificado; faltar lá derrubaria
     * a API inteira, licença e renovação junto, por causa do fiscal.
     */
    const tokenDaConta =
      process.env.FOCUS_NFE_PARTNER_TOKEN?.trim() || process.env.FOCUS_CONTA_TOKEN?.trim()

    if (!tokenDaConta) {
      this.logger.error(
        'FOCUS_NFE_PARTNER_TOKEN ausente: o certificado do cliente não pôde ser enviado à Focus.',
      )
      throw new HttpException(
        {
          codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA',
          mensagem: 'O envio de certificado ainda não está habilitado nesta plataforma.',
        },
        HttpStatus.NOT_IMPLEMENTED,
      )
    }

    /**
     * O `focusEmpresaId`, descoberto sozinho quando a ficha não o tem.
     *
     * Ele é DERIVÁVEL: temos o CNPJ aqui e o token de parceiro no ambiente, e a
     * Focus filtra empresa por CNPJ. Exigir que um humano copiasse esse número
     * de um painel para o outro só criava uma forma nova de errar — e quando
     * faltava, a resposta era 501 e o lojista lia "a plataforma ainda não
     * recebe certificado", procurando defeito no deploy, no `.env` e na Focus,
     * que era exatamente onde o problema não estava.
     *
     * O que continua NÃO sendo automático é CRIAR a empresa: isso exige
     * endereço completo e regime tributário, que esta ficha não guarda, e
     * empresa criada pela metade na Focus é pior do que nenhuma — passa a
     * existir, some da lista de pendências e falha só na primeira nota.
     */
    let empresaId = config.focusEmpresaId

    if (!empresaId) {
      let encontrada: any = null
      try {
        encontrada = await this.focusNfeService.buscarEmpresaPorCnpj(tokenDaConta, config.cnpj)
      } catch (erro) {
        // Mesma conversão do envio abaixo: 401/403 aqui é o NOSSO token, e
        // deixá-lo passar cru faria o lojista mexer no certificado dele.
        if (erro instanceof HttpException && [401, 403].includes(erro.getStatus())) {
          this.logger.error('A Focus recusou o token de parceiro ao procurar a empresa pelo CNPJ.')
          throw new HttpException(
            {
              codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA',
              mensagem: 'O envio de certificado ainda não está habilitado nesta plataforma.',
            },
            HttpStatus.NOT_IMPLEMENTED,
          )
        }
        throw erro
      }

      if (!encontrada?.id) {
        this.logger.error(
          `Cliente ${config.clienteId}: nenhuma empresa de CNPJ ${config.cnpj} no cadastro da Focus.`,
        )
        throw new HttpException(
          {
            codigo: 'EMPRESA_SEM_CADASTRO_NA_EMISSORA',
            mensagem: 'A empresa ainda não está cadastrada na emissora.',
          },
          HttpStatus.NOT_IMPLEMENTED,
        )
      }

      empresaId = String(encontrada.id)

      /**
       * Gravado ANTES de enviar o certificado, de propósito.
       *
       * Se o envio falhar por outro motivo — senha errada, Focus fora do ar —,
       * o id descoberto continua correto e a próxima tentativa não repete a
       * consulta. Guardar só depois do sucesso jogaria fora um dado válido por
       * causa de uma falha que não tem relação com ele.
       */
      await prisma.empresaFiscalConfig.update({
        where: { clienteId: config.clienteId },
        data:  { focusEmpresaId: empresaId },
      })

      this.logger.log(
        `Empresa ${empresaId} descoberta na Focus pelo CNPJ ${config.cnpj} e vinculada ao cliente ${config.clienteId}.`,
      )
    }

    let empresa: any
    try {
      empresa = await this.focusNfeService.atualizarEmpresa(tokenDaConta, empresaId, {
        arquivo_certificado_base64: arquivoBase64,
        senha_certificado: senha,
        /**
         * Empresa cadastrada e não habilitada não emite, e o erro só aparece na
         * primeira nota. Reafirmar aqui é barato e fecha esse buraco.
         *
         * São DUAS flags, não uma: `habilita_nfce` é independente na Focus.
         * Mandar só a primeira deixava a loja que comprou NFC-e com o
         * certificado aceito, o painel todo verde e a Focus recusando o
         * primeiro cupom — o pior desfecho, porque acontece no balcão.
         *
         * As duas vão sempre, para todo cliente, e isso NÃO é dar módulo de
         * graça: quem decide o que a loja pode emitir é o `ModuloGuard`, aqui
         * do nosso lado, e ele barra `/erp/fiscal/nfce/*` sem o módulo NFCE.
         * Estas flags são capacidade na emissora, não licença. Amarrá-las ao
         * módulo criaria uma segunda trava, invisível e fora do nosso banco,
         * que só se manifesta na primeira nota depois da venda do módulo.
         *
         * Não condicionamos `habilita_nfce` ao `cscConfigurado` pela mesma
         * razão: o CSC costuma ser cadastrado DEPOIS do certificado, e nada
         * reenvia esta chamada quando ele chega — a loja ficaria presa até
         * alguém reenviar o certificado à mão para destravar o cupom.
         */
        habilita_nfe:  true,
        habilita_nfce: true,
      })
    } catch (erro) {
      /**
       * 401/403 da Focus é o NOSSO token, nunca o certificado do cliente.
       *
       * Deixar passar cru mandaria o lojista trocar a senha de um certificado
       * que está perfeito. Vira 501 pela mesma razão dos casos acima: o que
       * falta é da plataforma.
       */
      if (erro instanceof HttpException && [401, 403].includes(erro.getStatus())) {
        this.logger.error('A Focus recusou o token de parceiro (FOCUS_NFE_PARTNER_TOKEN) ao enviar certificado.')
        throw new HttpException(
          {
            codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA',
            mensagem: 'O envio de certificado ainda não está habilitado nesta plataforma.',
          },
          HttpStatus.NOT_IMPLEMENTED,
        )
      }
      // O resto sobe como veio: senha errada e CNPJ divergente são justamente o
      // que o lojista precisa ler, e quem sabe dizer isso é a emissora.
      throw erro
    }

    /**
     * A empresa devolve os DOIS tokens; guardamos o do ambiente desta ficha.
     *
     * `getBaseUrl` escolhe o host pelo `ambiente`, então gravar o token de
     * produção numa ficha de homologação faria toda emissão bater em 401 no host
     * de teste. Token vazio na resposta não apaga o que já está lá: o admin pode
     * tê-lo colado à mão, e limpar por omissão desligaria a emissão em silêncio.
     */
    const tokenDoAmbiente = config.ambiente === AMBIENTE_PRODUCAO
      ? empresa?.token_producao
      : empresa?.token_homologacao

    const validoAte = empresa?.certificado_valido_ate
      ? new Date(empresa.certificado_valido_ate)
      : null
    const vencimento = validoAte && !Number.isNaN(validoAte.getTime()) ? validoAte : null

    await prisma.empresaFiscalConfig.update({
      where: { clienteId: config.clienteId },
      data: {
        certificadoStatus: 'ATIVO',
        ...(vencimento ? { certificadoVencimento: vencimento } : {}),
        ...(typeof tokenDoAmbiente === 'string' && tokenDoAmbiente
          ? { focusEmpresaToken: tokenDoAmbiente }
          : {}),
      },
    })

    this.logger.log(`Certificado do cliente ${config.clienteId} cadastrado na Focus NFe.`)

    /**
     * A resposta que o ERP lê. Nenhum segredo sai daqui — nem a senha, nem o
     * token da empresa, nem o arquivo. O `valido_ate` é o que a tela do Centro
     * Fiscal mostra ao lojista.
     */
    return {
      status: 'ATIVO',
      habilitado: true,
      cnpj: config.cnpj,
      valido_ate: vencimento ? vencimento.toISOString() : null,
      mensagem: 'Certificado cadastrado na emissora.',
    }
  }

  /**
   * Trilha de suporte. Best-effort: quando isto roda a Focus já respondeu, e
   * estourar aqui devolveria erro ao ERP para uma operação que deu certo — o
   * operador emitiria de novo. Falha vira log, não exceção.
   */
  private async registrarEvento(params: {
    licencaId:  string
    ref:        string
    ambiente:   number
    tipoDocumento: string
    acao:       'EMISSAO' | 'CANCELAMENTO' | 'INUTILIZACAO'
    resultado:  string
    httpStatus?: number | null
    mensagem?:  string | null
  }) {
    try {
      await prisma.emissaoLog.create({
        data: {
          licencaId:  params.licencaId,
          ref:        params.ref,
          ambiente:   params.ambiente,
          tipoDocumento: params.tipoDocumento,
          acao:       params.acao,
          resultado:  params.resultado,
          httpStatus: params.httpStatus ?? null,
          // Truncada: mensagem da SEFAZ é curta, mas erro de integração vem com
          // dump inteiro às vezes, e este log é para durar pouco e ler rápido.
          mensagem:   params.mensagem ? params.mensagem.slice(0, 500) : null,
        },
      })
    } catch (err) {
      this.logger.error(`Falha ao gravar trilha da ref "${params.ref}": ${err instanceof Error ? err.message : err}`)
    }
  }

  /**
   * Resposta já dada para esta chave de idempotência, se houver.
   *
   * A chave reapresentada para OUTRA operação, ou para outra `ref`, é recusada
   * em vez de respondida: as duas coisas significam que o chamador reusou a
   * chave por engano, e repetir a primeira resposta faria a segunda venda
   * desaparecer sem nenhum sinal — o oposto do que a idempotência existe para
   * proteger.
   */
  private async consultarIdempotencia(
    licencaId: string,
    chave: string | undefined,
    operacao: 'EMISSAO' | 'INUTILIZACAO',
    ref: string | null,
  ): Promise<ResultadoNota | null> {
    if (!chave) return null

    const registro = await prisma.idempotenciaFiscal.findUnique({
      where: { licencaId_chave: { licencaId, chave } },
    })
    if (!registro) return null

    if (registro.operacao !== operacao || (ref !== null && registro.ref !== ref)) {
      this.logger.warn(`Chave de idempotência "${chave}" da licença ${licencaId} reapresentada para ${operacao}/${ref ?? '-'}, mas pertence a ${registro.operacao}/${registro.ref ?? '-'}.`)
      throw new ConflictException(
        'Esta chave de idempotência já foi usada para outra operação. Gere uma chave nova — repetir a anterior devolveria o resultado da operação errada.',
      )
    }

    this.logger.log(`Chave de idempotência "${chave}" já respondida para a licença ${licencaId}: devolvendo o resultado original.`)
    return registro.resultado as unknown as ResultadoNota
  }

  /**
   * Best-effort, e de propósito: quando isto roda a nota já foi emitida. Falhar
   * aqui e propagar o erro faria o ERP achar que a emissão falhou e tentar de
   * novo — que é exatamente a nota duplicada que esta tabela existe para evitar.
   * A `ref` continua sendo a trava principal; esta é a segunda camada.
   */
  private async gravarIdempotencia(params: {
    licencaId: string
    chave?:    string
    operacao:  'EMISSAO' | 'INUTILIZACAO'
    ref:       string | null
    resultado: ResultadoNota
  }) {
    if (!params.chave) return
    try {
      await prisma.idempotenciaFiscal.create({
        data: {
          licencaId: params.licencaId,
          chave:     params.chave,
          operacao:  params.operacao,
          ref:       params.ref,
          resultado: params.resultado as unknown as object,
        },
      })
    } catch (err) {
      this.logger.error(`Falha ao gravar idempotência "${params.chave}" da licença ${params.licencaId}: ${err instanceof Error ? err.message : err}`)
    }
  }

  /**
   * Soma 1 ao contador do mês.
   *
   * O `increment` do Postgres resolve a corrida: dois caixas do mesmo cliente
   * emitindo ao mesmo tempo somam 2, não 1. Também é best-effort, e a falha aqui
   * erra para BAIXO de propósito — deixar de contar uma nota é preferível a
   * bloquear um cliente que pagou por causa de uma escrita nossa que falhou.
   */
  private async incrementarConsumo(
    licencaId: string,
    ambiente: number,
    tipoDocumento: string,
    campo: 'emitidas' | 'canceladas',
  ) {
    const competencia = competenciaAtual()
    try {
      await prisma.consumoFiscal.upsert({
        where:  { licencaId_competencia_ambiente_tipoDocumento: { licencaId, competencia, ambiente, tipoDocumento } },
        update: { [campo]: { increment: 1 } },
        create: { licencaId, competencia, ambiente, tipoDocumento, [campo]: 1 },
      })
    } catch (err) {
      this.logger.error(`Falha ao contabilizar ${campo} de ${tipoDocumento} da licença ${licencaId} em ${competencia}: ${err instanceof Error ? err.message : err}`)
    }
  }

  /**
   * Consumo e teto do mês corrente para uma licença, POR TIPO DE DOCUMENTO.
   *
   * O tipo é obrigatório na conta porque cada documento é um módulo com cota
   * própria: sem separar, uma NFC-e emitida consumiria a cota da NF-e, e o
   * cliente seria bloqueado num documento por causa do uso de outro.
   *
   * Só produção entra. `cota: null` significa ilimitado — o estado de todo plano
   * até alguém preencher o campo.
   *
   * Devolve também o AMBIENTE vigente, porque quem decide isso é a configuração
   * do cliente e o ERP não teria como saber: uma tela dizendo "Homologação"
   * enquanto a plataforma emite em produção é pior do que não ter tela.
   * `configurado: false` é resposta, não erro — cliente sem config fiscal ainda
   * precisa conseguir abrir a tela para descobrir o que falta.
   */
  async consumoMensal(
    licencaId: string,
    tipoDocumento: string = MODULO_NFE,
    /**
     * A config já carregada por quem chamou. A emissão a busca antes de tudo, e
     * sem este parâmetro o caminho quente da nota faria a mesma consulta duas
     * vezes só para preencher um campo informativo.
     */
    configConhecida?: { ambiente: number } | null,
  ) {
    const competencia = competenciaAtual()

    /**
     * `buscarEmpresaConfig` já confere se a licença existe. Quando a config vem
     * pronta, quem chamou passou por lá — repetir a checagem aqui seria uma
     * consulta a mais no caminho de cada nota para reconfirmar o que acabou de
     * ser confirmado.
     */
    const config = configConhecida !== undefined
      ? configConhecida
      : await this.buscarEmpresaConfig(licencaId)

    const consumo = await prisma.consumoFiscal.findUnique({
      where: { licencaId_competencia_ambiente_tipoDocumento: { licencaId, competencia, ambiente: AMBIENTE_PRODUCAO, tipoDocumento } },
    })

    /**
     * A cota vem do vínculo licença↔módulo, e o identificador do módulo é o
     * MESMO valor do tipo de documento — por isso a busca aqui é direta.
     * Enquanto o catálogo não estiver configurado não existe vínculo, `null`
     * volta, e ninguém é bloqueado por uma cota que nunca foi definida.
     */
    const cotaPlano = await resolverCotaModulo(licencaId, tipoDocumento)
    const cotaExtra = consumo?.cotaExtra ?? 0
    const emitidas  = consumo?.emitidas ?? 0

    // Plano ilimitado ignora o extra: somar avulsas a "sem teto" não significa
    // nada, e mostrar um número aqui daria a impressão errada de que há limite.
    const cota = cotaPlano === null ? null : cotaPlano + cotaExtra

    return {
      tipoDocumento,
      competencia,
      emitidas,
      canceladas: consumo?.canceladas ?? 0,
      cotaPlano,
      cotaExtra,
      cota,
      restantes:  cota === null ? null : Math.max(0, cota - emitidas),
      ilimitado:  cota === null,
      configurado:  !!config,
      ambiente:     config?.ambiente ?? null,
      ambienteNome: config ? nomeAmbiente(config.ambiente) : null,
    }
  }

  /**
   * Concede notas avulsas para o mês corrente.
   *
   * É a saída manual enquanto a venda de pacote não existe: cliente estourou a
   * cota no dia 20, o admin libera o que faltava e a emissão volta na hora — sem
   * precisar trocar o plano dele nem mexer no teto de todo mundo que usa aquele
   * plano. Some na virada do mês, junto com a linha da competência.
   */
  async concederExtras(licencaId: string, quantidade: number, motivo?: string, tipoDocumento: string = MODULO_NFE) {
    const licenca = await prisma.licenca.findUnique({ where: { id: licencaId }, select: { id: true } })
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    await concederNotasExtras(licencaId, quantidade, tipoDocumento)
    this.logger.log(`[fiscal] ${quantidade} nota(s) avulsa(s) concedida(s) à licença ${licencaId}${motivo ? ` — ${motivo}` : ''}.`)

    return this.consumoMensal(licencaId, tipoDocumento)
  }

  async emitir(
    licencaId: string,
    ref: string,
    payload: any,
    tipoDocumento: TipoDocumentoEmissivel = MODULO_NFE,
    chaveIdempotencia?: string,
  ) {
    const config  = await this.getEmpresaConfig(licencaId)
    const recurso = RECURSO_FOCUS[tipoDocumento]

    /**
     * A chave de idempotência vem antes de tudo, inclusive da cota.
     *
     * Uma repetição não é uma venda nova: se a primeira passou, a segunda tem de
     * devolver a mesma resposta mesmo que a cota tenha estourado no intervalo.
     * Barrar aqui por cota deixaria o ERP sem a resposta de uma nota que existe.
     */
    const jaRespondido = await this.consultarIdempotencia(licencaId, chaveIdempotencia, 'EMISSAO', ref)
    if (jaRespondido) return jaRespondido

    /**
     * O emitente da nota tem que ser o CNPJ desta licença.
     *
     * O payload vem do ERP instalado na máquina do cliente, mas o token de
     * emissão é escolhido aqui, pela licença do token JWT. Sem esta conferência,
     * um ERP adulterado emitiria com o token de um CNPJ e os dados de outro, e a
     * única barreira seria a validação da Focus — a nossa autorização estaria
     * decidindo uma coisa e a emissão fazendo outra.
     *
     * A NFC-e traz o emitente em `cnpj_emitente`, a NF-e em `emitente.cnpj`.
     * Vazio nos dois passa: é a Focus quem preenche o emitente a partir do
     * token quando o ERP não manda, e exigir aqui um campo que ela dispensa
     * recusaria nota correta.
     */
    const cnpjEmitente = String(payload?.emitente?.cnpj ?? payload?.cnpj_emitente ?? '').replace(/\D/g, '')
    if (cnpjEmitente && cnpjEmitente !== config.cnpj) {
      this.logger.warn(`Emissão barrada: licença ${licencaId} está configurada para o CNPJ ${config.cnpj} e o payload veio com ${cnpjEmitente}.`)
      throw new BadRequestException('O CNPJ do emitente não corresponde à configuração fiscal desta licença.')
    }

    /**
     * Cota mensal do plano.
     *
     * Fica ANTES da idempotência por `ref` de propósito: uma reemissão da mesma
     * ref não pode ser barrada por cota, mas quem já estourou o teto também não
     * pode gastar chamada na Focus para descobrir isso. Homologação passa
     * direto — teste do cliente não consome o pacote que ele pagou.
     */
    if (config.ambiente === AMBIENTE_PRODUCAO) {
      const uso = await this.consumoMensal(licencaId, tipoDocumento, config)
      if (!uso.ilimitado && uso.restantes === 0) {
        this.logger.warn(`Emissão barrada por cota: licença ${licencaId} usou ${uso.emitidas}/${uso.cota} de ${tipoDocumento} em ${uso.competencia}.`)
        throw new HttpException(
          `Cota de ${uso.cota} documentos (${tipoDocumento}) deste mês esgotada (${uso.emitidas} emitidos). Contrate notas adicionais ou aguarde a virada do mês.`,
          HttpStatus.PAYMENT_REQUIRED,
        )
      }
    }

    // Trava de idempotência: confere na Focus se esta ref já foi enviada.
    try {
      this.logger.log(`Verificando se ref "${ref}" já existe na Focus NFe para garantir idempotência`)
      const notaExistente = await this.focusNfeService.consultar(
        config.focusEmpresaToken,
        recurso,
        ref,
        config.ambiente
      )
      /**
       * A Focus sinaliza "não existe" de duas formas conforme o caso: 404, que
       * cai no catch abaixo, e 200 com `status: "nao_encontrado"`. As duas
       * precisam liberar a emissão — tratar a segunda como nota existente
       * faria o serviço parar de emitir sem nunca acusar erro.
       */
      if (notaExistente?.status && notaExistente.status !== 'nao_encontrado') {
        this.logger.log(`Ref "${ref}" já emitida anteriormente. Retornando status existente.`)
        const jaEmitida = this.mapResultado(notaExistente, config.ambiente, tipoDocumento)
        await this.gravarIdempotencia({ licencaId, chave: chaveIdempotencia, operacao: 'EMISSAO', ref, resultado: jaEmitida })
        return jaEmitida
      }
    } catch (e) {
      /**
       * 404 é o caso feliz: a nota ainda não existe, pode emitir.
       *
       * Qualquer outra falha (Focus fora do ar, timeout, 500) significa que NÃO
       * sabemos se a ref já foi usada — e emitir sem saber é o caminho para a
       * nota em duplicidade, que não se resolve com deploy, se resolve com
       * contador e SEFAZ. Na dúvida, para e devolve retry.
       */
      const status = e instanceof HttpException ? e.getStatus() : 0
      if (status !== 404) {
        this.logger.error(`Idempotência indeterminada para ref "${ref}" (HTTP ${status || 'sem status'}): emissão abortada por segurança.`)
        throw new HttpException(
          'Não foi possível confirmar na Focus NFe se esta nota já existe. Nenhuma nota foi emitida — tente novamente em instantes.',
          HttpStatus.SERVICE_UNAVAILABLE,
        )
      }
    }

    const res = await this.focusNfeService.emitir(
      config.focusEmpresaToken,
      recurso,
      ref,
      payload,
      config.ambiente
    )

    const resultado = this.mapResultado(res, config.ambiente, tipoDocumento)

    /**
     * O desfecho da nota vai para o log, autorizada ou não.
     *
     * Sem isto, uma nota AUTORIZADA e uma REJEITADA pela SEFAZ deixam o mesmo
     * rastro: a linha "Enviando..." e mais nada. Só a recusa da própria Focus
     * (HTTP 4xx) aparecia, porque quem registrava era o tratamento de erro. Uma
     * rejeição da SEFAZ chega em HTTP 200 — a Focus aceitou e transmitiu, a
     * receita estadual é que recusou — e passava em silêncio absoluto.
     *
     * O `codigo_sefaz` é o que importa mais que o texto: a rejeição da SEFAZ é
     * numerada, e o número diz sem ambiguidade qual regra falhou. A mensagem
     * descreve, o código identifica.
     */
    if (resultado.status === 'autorizado') {
      this.logger.log(`${tipoDocumento} ref "${ref}" AUTORIZADA pela SEFAZ (protocolo ${resultado.protocolo ?? 'não informado'}).`)
    } else if (resultado.status === 'processando') {
      this.logger.log(`${tipoDocumento} ref "${ref}" em processamento na SEFAZ.`)
    } else {
      this.logger.warn(
        `${tipoDocumento} ref "${ref}" NÃO autorizada: status_focus="${resultado.status_focus}"` +
        ` codigo_sefaz=${resultado.codigo_sefaz ?? 'nenhum'} — ${resultado.mensagem_sefaz ?? 'sem mensagem'}`,
      )
    }

    /**
     * Contabiliza depois da resposta da Focus, e só o que ela aceitou.
     *
     * "processando" conta: a nota entrou na fila da SEFAZ e vai virar documento.
     * "erro" não conta — nota rejeitada não consumiu nada do cliente, e cobrar
     * cota por tentativa que falhou seria cobrar pelo nosso problema.
     */
    if (resultado.status === 'autorizado' || resultado.status === 'processando') {
      await this.incrementarConsumo(licencaId, config.ambiente, tipoDocumento, 'emitidas')
    }

    await this.gravarIdempotencia({ licencaId, chave: chaveIdempotencia, operacao: 'EMISSAO', ref, resultado })

    await this.registrarEvento({
      licencaId,
      ref,
      ambiente:  config.ambiente,
      tipoDocumento,
      acao:      'EMISSAO',
      resultado: resultado.status,
      mensagem:  resultado.mensagem_sefaz,
    })

    return resultado
  }

  /**
   * Consulta o status atual na Focus.
   *
   * Não grava nada: quem tem o estado da nota é a Focus, e guardar uma cópia
   * aqui só criaria uma segunda versão da verdade para envelhecer sozinha.
   */
  async consultar(licencaId: string, ref: string, tipoDocumento: TipoDocumentoEmissivel = MODULO_NFE) {
    const config = await this.getEmpresaConfig(licencaId)
    const res = await this.focusNfeService.consultar(
      config.focusEmpresaToken,
      RECURSO_FOCUS[tipoDocumento],
      ref,
      config.ambiente
    )

    const resultado = this.mapResultado(res, config.ambiente, tipoDocumento)

    /**
     * O desfecho REAL de uma nota chega aqui, e não na emissão.
     *
     * A emissão devolve "processando": a Focus aceitou o XML e a SEFAZ ainda
     * não decidiu. Quem traz autorização ou rejeição é esta consulta, feita
     * pelo ERP em seguida. Logar só a emissão — como estava — deixava sem
     * rastro justamente o momento em que a resposta aparece: o log dizia "em
     * processamento" e nunca mais tocava no assunto, enquanto o operador via
     * uma rejeição na tela.
     *
     * `processando` não vira linha: o ERP repete esta consulta em intervalos
     * curtos até a SEFAZ responder, e uma linha por tentativa afogaria o log
     * com a única informação que não mudou.
     */
    if (resultado.status === 'autorizado') {
      this.logger.log(`${tipoDocumento} ref "${ref}" AUTORIZADA pela SEFAZ (protocolo ${resultado.protocolo ?? 'não informado'}).`)
    } else if (resultado.status !== 'processando') {
      this.logger.warn(
        `${tipoDocumento} ref "${ref}" com status "${resultado.status}" na consulta:` +
        ` status_focus="${resultado.status_focus}" codigo_sefaz=${resultado.codigo_sefaz ?? 'nenhum'}` +
        ` — ${resultado.mensagem_sefaz ?? 'sem mensagem'}`,
      )
    }

    return resultado
  }

  async cancelar(
    licencaId: string,
    ref: string,
    justificativa: string,
    tipoDocumento: TipoDocumentoEmissivel = MODULO_NFE,
  ) {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new BadRequestException('A justificativa de cancelamento deve conter no mínimo 15 caracteres.')
    }

    const config = await this.getEmpresaConfig(licencaId)
    const res = await this.focusNfeService.cancelar(
      config.focusEmpresaToken,
      RECURSO_FOCUS[tipoDocumento],
      ref,
      justificativa,
      config.ambiente
    )

    const resultado = this.mapResultado(res, config.ambiente, tipoDocumento)

    // Cancelar não devolve cota: a nota existiu na SEFAZ. O contador próprio
    // serve para o painel explicar a diferença entre emitidas e válidas.
    if (resultado.status === 'cancelado') {
      await this.incrementarConsumo(licencaId, config.ambiente, tipoDocumento, 'canceladas')
    }

    await this.registrarEvento({
      licencaId,
      ref,
      ambiente:  config.ambiente,
      tipoDocumento,
      acao:      'CANCELAMENTO',
      resultado: resultado.status,
      mensagem:  resultado.mensagem_sefaz,
    })

    return resultado
  }

  /**
   * Inutiliza uma faixa de numeração que não virou nota.
   *
   * O CNPJ vem da configuração da licença, nunca do corpo: é a mesma regra da
   * emissão, e aqui vale ainda mais — inutilizar numeração de OUTRO emitente é
   * um evento que a SEFAZ registra e ninguém desfaz.
   *
   * Não existe `ref` nesta operação, então a única proteção contra a repetição é
   * a chave de idempotência do ERP. Sem ela a chamada é aceita, mas uma segunda
   * tentativa chega inteira na SEFAZ.
   */
  async inutilizar(
    licencaId: string,
    dados: { serie: number; numero_inicial: number; numero_final: number; justificativa: string } & Record<string, unknown>,
    tipoDocumento: TipoDocumentoEmissivel = MODULO_NFE,
    chaveIdempotencia?: string,
  ) {
    const config = await this.getEmpresaConfig(licencaId)

    /**
     * A faixa faz o papel da `ref` na idempotência.
     *
     * Sem ela, a mesma chave reapresentada para OUTRA faixa devolveria o
     * resultado da primeira e a segunda inutilização sumiria sem sinal — o ERP
     * acharia que inutilizou uma numeração que continua aberta. Guardada, a
     * repetição por engano vira 409 em vez de mentira.
     */
    const faixa = `s${dados.serie}-${dados.numero_inicial}-${dados.numero_final}${dados.ano ? `-${dados.ano}` : ''}`

    const jaRespondido = await this.consultarIdempotencia(licencaId, chaveIdempotencia, 'INUTILIZACAO', faixa)
    if (jaRespondido) return jaRespondido

    if (!chaveIdempotencia) {
      this.logger.warn(`Inutilização sem X-Idempotency-Key na licença ${licencaId} (série ${dados.serie}, ${dados.numero_inicial}-${dados.numero_final}): uma repetição desta chamada chegará inteira na SEFAZ.`)
    }

    const res = await this.focusNfeService.inutilizar(
      config.focusEmpresaToken,
      RECURSO_FOCUS[tipoDocumento],
      { cnpj: config.cnpj, ...dados },
      config.ambiente,
    )

    const resultado = this.mapResultado(res, config.ambiente, tipoDocumento)

    await this.gravarIdempotencia({ licencaId, chave: chaveIdempotencia, operacao: 'INUTILIZACAO', ref: faixa, resultado })

    // A faixa no lugar da ref: é o que identifica o evento, e é o que alguém vai
    // procurar no log quando o cliente perguntar por uma numeração sumida.
    await this.registrarEvento({
      licencaId,
      ref:       `inutilizacao-${faixa}`,
      ambiente:  config.ambiente,
      tipoDocumento,
      acao:      'INUTILIZACAO',
      resultado: resultado.status,
      mensagem:  resultado.mensagem_sefaz,
    })

    return resultado
  }
}
