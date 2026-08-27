import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { prisma, concederNotasExtras, resolverCotaModulo, MODULO_NFE } from '@startbig/database'
import { FocusNfeService } from '../../common/focus-nfe/focus-nfe.service'

const AMBIENTE_PRODUCAO = 1

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

/** Resposta da Focus já normalizada para o formato que o ERP e o painel leem. */
type ResultadoNota = {
  status:         string
  chave_acesso:   string | null
  protocolo:      string | null
  numero:         number | null
  serie:          number | null
  url_pdf:        string | null
  url_xml:        string | null
  codigo_sefaz:   number | null
  mensagem_sefaz: string | null
}

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name)

  constructor(private readonly focusNfeService: FocusNfeService) {}

  private mapResultado(data: any, ambiente: number): ResultadoNota {
    let status = 'erro'
    const statusFocus = data.status || ''

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

    const domain = ambiente === 1
      ? 'https://api.focusnfe.com.br'
      : 'https://homologacao.focusnfe.com.br'

    const urlPdf = data.caminho_danfe_pdf
      ? (data.caminho_danfe_pdf.startsWith('http') ? data.caminho_danfe_pdf : `${domain}${data.caminho_danfe_pdf}`)
      : null

    const urlXml = data.caminho_xml_nota_fiscal
      ? (data.caminho_xml_nota_fiscal.startsWith('http') ? data.caminho_xml_nota_fiscal : `${domain}${data.caminho_xml_nota_fiscal}`)
      : null

    return {
      status,
      chave_acesso: data.chave_nfe || data.chave || null,
      protocolo: data.protocolo || null,
      numero: data.numero ? Number(data.numero) : null,
      serie: data.serie ? Number(data.serie) : null,
      url_pdf: urlPdf,
      url_xml: urlXml,
      codigo_sefaz: data.codigo_sefaz ? Number(data.codigo_sefaz) : null,
      mensagem_sefaz: data.mensagem_sefaz || null,
    }
  }

  private async getEmpresaConfig(licencaId: string) {
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

    if (!config) {
      throw new NotFoundException('Empresa não possui configuração fiscal ativa.')
    }

    if (!config.focusEmpresaToken) {
      throw new BadRequestException('Token de emissão da Focus NFe pendente de configuração.')
    }

    return { ...config, focusEmpresaToken: config.focusEmpresaToken, clienteId: licenca.clienteId }
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
    acao:       'EMISSAO' | 'CANCELAMENTO'
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
   */
  async consumoMensal(licencaId: string, tipoDocumento: string = MODULO_NFE) {
    const competencia = competenciaAtual()

    const licenca = await prisma.licenca.findUnique({
      where:  { id: licencaId },
      select: { id: true },
    })
    if (!licenca) throw new NotFoundException('Licença não encontrada no servidor.')

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

  async emitir(licencaId: string, ref: string, payload: any) {
    const config = await this.getEmpresaConfig(licencaId)

    /**
     * O emitente da nota tem que ser o CNPJ desta licença.
     *
     * O payload vem do ERP instalado na máquina do cliente, mas o token de
     * emissão é escolhido aqui, pela licença do token JWT. Sem esta conferência,
     * um ERP adulterado emitiria com o token de um CNPJ e os dados de outro, e a
     * única barreira seria a validação da Focus — a nossa autorização estaria
     * decidindo uma coisa e a emissão fazendo outra.
     */
    const cnpjEmitente = String(payload?.emitente?.cnpj ?? '').replace(/\D/g, '')
    if (cnpjEmitente !== config.cnpj) {
      this.logger.warn(`Emissão barrada: licença ${licencaId} está configurada para o CNPJ ${config.cnpj} e o payload veio com ${cnpjEmitente || '(vazio)'}.`)
      throw new BadRequestException('O CNPJ do emitente não corresponde à configuração fiscal desta licença.')
    }

    /**
     * Cota mensal do plano.
     *
     * Fica ANTES da idempotência de propósito: uma reemissão da mesma ref não
     * pode ser barrada por cota, mas quem já estourou o teto também não pode
     * gastar chamada na Focus para descobrir isso. Homologação passa direto —
     * teste do cliente não consome o pacote que ele pagou.
     */
    if (config.ambiente === AMBIENTE_PRODUCAO) {
      const uso = await this.consumoMensal(licencaId)
      if (!uso.ilimitado && uso.restantes === 0) {
        this.logger.warn(`Emissão barrada por cota: licença ${licencaId} usou ${uso.emitidas}/${uso.cota} em ${uso.competencia}.`)
        throw new HttpException(
          `Cota de ${uso.cota} notas fiscais deste mês esgotada (${uso.emitidas} emitidas). Contrate notas adicionais ou aguarde a virada do mês.`,
          HttpStatus.PAYMENT_REQUIRED,
        )
      }
    }

    // Trava de idempotência: confere na Focus se esta ref já foi enviada.
    try {
      this.logger.log(`Verificando se ref "${ref}" já existe na Focus NFe para garantir idempotência`)
      const notaExistente = await this.focusNfeService.consultar(
        config.focusEmpresaToken,
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
        return this.mapResultado(notaExistente, config.ambiente)
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
      ref,
      payload,
      config.ambiente
    )

    const resultado = this.mapResultado(res, config.ambiente)

    /**
     * Contabiliza depois da resposta da Focus, e só o que ela aceitou.
     *
     * "processando" conta: a nota entrou na fila da SEFAZ e vai virar documento.
     * "erro" não conta — nota rejeitada não consumiu nada do cliente, e cobrar
     * cota por tentativa que falhou seria cobrar pelo nosso problema.
     */
    if (resultado.status === 'autorizado' || resultado.status === 'processando') {
      await this.incrementarConsumo(licencaId, config.ambiente, MODULO_NFE, 'emitidas')
    }

    await this.registrarEvento({
      licencaId,
      ref,
      ambiente:  config.ambiente,
      tipoDocumento: MODULO_NFE,
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
  async consultar(licencaId: string, ref: string) {
    const config = await this.getEmpresaConfig(licencaId)
    const res = await this.focusNfeService.consultar(
      config.focusEmpresaToken,
      ref,
      config.ambiente
    )
    return this.mapResultado(res, config.ambiente)
  }

  async cancelar(licencaId: string, ref: string, justificativa: string) {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new BadRequestException('A justificativa de cancelamento deve conter no mínimo 15 caracteres.')
    }

    const config = await this.getEmpresaConfig(licencaId)
    const res = await this.focusNfeService.cancelar(
      config.focusEmpresaToken,
      ref,
      justificativa,
      config.ambiente
    )

    const resultado = this.mapResultado(res, config.ambiente)

    // Cancelar não devolve cota: a nota existiu na SEFAZ. O contador próprio
    // serve para o painel explicar a diferença entre emitidas e válidas.
    if (resultado.status === 'cancelado') {
      await this.incrementarConsumo(licencaId, config.ambiente, MODULO_NFE, 'canceladas')
    }

    await this.registrarEvento({
      licencaId,
      ref,
      ambiente:  config.ambiente,
      tipoDocumento: MODULO_NFE,
      acao:      'CANCELAMENTO',
      resultado: resultado.status,
      mensagem:  resultado.mensagem_sefaz,
    })

    return resultado
  }
}
