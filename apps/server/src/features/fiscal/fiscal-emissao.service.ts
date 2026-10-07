import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common'
import { prisma, MODULO_NFE } from '@startbig/database'
import { FocusNfeService } from '../../common/focus-nfe/focus-nfe.service'
import { AMBIENTE_PRODUCAO, TipoDocumentoEmissivel, RECURSO_FOCUS, numeroOuNulo, nomeAmbiente, urlAbsolutaFocus, ResultadoNota, mapResultado, getEmpresaConfig } from './fiscal-comum'
import { FiscalCotaService } from './fiscal-cota.service'

/**
 * Emissão e eventos de nota: emitir, consultar, cancelar, carta de correção e
 * inutilizar — com a idempotência e a trilha (`EmissaoLog`) de cada um.
 */
@Injectable()
export class FiscalEmissaoService {
  private readonly logger = new Logger(FiscalEmissaoService.name)

  constructor(
    private readonly focusNfeService: FocusNfeService,
    private readonly cota: FiscalCotaService,
  ) {}

  async emitir(
    licencaId: string,
    ref: string,
    payload: any,
    tipoDocumento: TipoDocumentoEmissivel = MODULO_NFE,
    chaveIdempotencia?: string,
  ) {
    const config  = await getEmpresaConfig(licencaId)
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
      const uso = await this.cota.consumoMensal(licencaId, tipoDocumento, config)
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
        const jaEmitida = mapResultado(notaExistente, config.ambiente, tipoDocumento)
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

    const resultado = mapResultado(res, config.ambiente, tipoDocumento)

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
      await this.cota.incrementarConsumo(licencaId, config.ambiente, tipoDocumento, 'emitidas')
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
      codigoSefaz: resultado.codigo_sefaz,
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
    const config = await getEmpresaConfig(licencaId)

    let res: any
    try {
      res = await this.focusNfeService.consultar(
        config.focusEmpresaToken,
        RECURSO_FOCUS[tipoDocumento],
        ref,
        config.ambiente
      )
    } catch (erro) {
      /**
       * O 404 da emissora ganha código próprio, porque 404 aqui já significava
       * três coisas.
       *
       * Antes desta distinção, o ERP recebia o mesmo 404 para "esta nota não
       * existe na emissora", "licença não encontrada" e "cliente sem
       * configuração fiscal" — e os dois últimos acontecem ANTES de qualquer
       * pergunta à Focus, então não afirmam nada sobre a nota.
       *
       * A consequência era real e cara: o ERP que marcasse a nota como não
       * transmitida ao ver 404 marcaria também durante um soluço de
       * configuração nosso. Isso libera a venda para reemissão e produz nota
       * duplicada — duas autorizadas para a mesma venda, que não se resolve com
       * deploy, se resolve com contador e SEFAZ.
       *
       * Só ESTE código autoriza o chamador a concluir que a nota não chegou à
       * emissora.
       */
      if (erro instanceof HttpException && erro.getStatus() === 404) {
        const corpo = erro.getResponse() as any
        throw new NotFoundException({
          codigo:   'NOTA_NAO_ENCONTRADA_NA_EMISSORA',
          mensagem: corpo?.mensagem ?? 'Nota fiscal não encontrada na emissora.',
          ref,
        })
      }
      throw erro
    }

    const resultado = mapResultado(res, config.ambiente, tipoDocumento)

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

    await this.registrarDesfechoDaConsulta(licencaId, ref, config.ambiente, tipoDocumento, resultado)

    return resultado
  }

  /**
   * O desfecho da consulta vai também para a `EmissaoLog`, uma vez por nota.
   *
   * Até 07/10/2026 só a emissão gravava linha, e a emissão de NF-e quase sempre
   * responde "processando": a autorização e a rejeição da SEFAZ chegavam por
   * aqui e iam só para o log do processo. Resultado: para NF-e a tabela nunca
   * tinha "autorizado" nem o cStat da recusa — e é dela que o painel de saúde
   * fiscal (F4) e o censo tiram a última nota e as rejeições.
   *
   * Só `autorizado` e `erro`. `processando` não decidiu nada; `cancelado` já
   * tem a linha do CANCELAMENTO. E só se ainda não houver linha igual para a
   * ref: o ERP reconsulta a mesma nota (reabrir a venda, reimprimir), e uma
   * linha por consulta inflaria a contagem de rejeições do painel.
   *
   * Best-effort como o `registrarEvento`: o ERP está esperando a resposta da
   * nota, e falhar aqui não pode virar erro de consulta.
   */
  private async registrarDesfechoDaConsulta(
    licencaId: string,
    ref: string,
    ambiente: number,
    tipoDocumento: TipoDocumentoEmissivel,
    resultado: ResultadoNota,
  ) {
    if (resultado.status !== 'autorizado' && resultado.status !== 'erro') return
    try {
      const jaRegistrado = await prisma.emissaoLog.findFirst({
        where:  { licencaId, ref, acao: 'EMISSAO', resultado: resultado.status },
        select: { id: true },
      })
      if (jaRegistrado) return
    } catch (err) {
      this.logger.error(`Falha ao conferir trilha da ref "${ref}": ${err instanceof Error ? err.message : err}`)
      return
    }
    await this.registrarEvento({
      licencaId,
      ref,
      ambiente,
      tipoDocumento,
      acao:        'EMISSAO',
      resultado:   resultado.status,
      mensagem:    resultado.mensagem_sefaz,
      codigoSefaz: resultado.codigo_sefaz,
    })
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

    const config = await getEmpresaConfig(licencaId)
    const res = await this.focusNfeService.cancelar(
      config.focusEmpresaToken,
      RECURSO_FOCUS[tipoDocumento],
      ref,
      justificativa,
      config.ambiente
    )

    const resultado = mapResultado(res, config.ambiente, tipoDocumento)

    // Cancelar não devolve cota: a nota existiu na SEFAZ. O contador próprio
    // serve para o painel explicar a diferença entre emitidas e válidas.
    if (resultado.status === 'cancelado') {
      await this.cota.incrementarConsumo(licencaId, config.ambiente, tipoDocumento, 'canceladas')
    }

    await this.registrarEvento({
      licencaId,
      ref,
      ambiente:  config.ambiente,
      tipoDocumento,
      acao:      'CANCELAMENTO',
      resultado: resultado.status,
      mensagem:  resultado.mensagem_sefaz,
      codigoSefaz: resultado.codigo_sefaz,
    })

    return resultado
  }

  /**
   * Carta de correção de uma NF-e autorizada.
   *
   * Só NF-e, e sem `tipoDocumento`: NFC-e não tem esse evento. Não consome
   * cota — a nota já foi contada quando saiu — e não passa pelo
   * `mapResultado`, porque a resposta da Focus aqui é outra: não há chave,
   * número nem série; há o número sequencial da carta e os arquivos DELA, não
   * os da nota.
   *
   * O contrato com o ERP tem um discriminador que importa mais que o resto:
   * `codigo_sefaz` só existe quando a SEFAZ de fato respondeu. É assim que o
   * ERP separa "rejeitada" (não reenviar) de "nem chegou a transmitir" (pode
   * tentar de novo). Como a Focus é síncrona nesta rota, a resposta 200 SEMPRE
   * traz o veredito da SEFAZ — autorizada ou rejeitada —, e os 4xx dela
   * (parâmetro inválido, nota não autorizada, nota não encontrada) vêm sem
   * `status_sefaz`. Eles seguem para o ERP como HttpException, pelo filtro
   * global, que repassa `codigo` e `message` e não inventa `codigo_sefaz`.
   *
   * Não há idempotência: a Focus numera cada carta e a SEFAZ considera vigente
   * só a última. Uma repetição por engano gera uma segunda carta com o mesmo
   * texto — inconveniente, não incorreto — e não há como distingui-la de uma
   * correção legítima idêntica.
   */
  async cartaCorrecao(licencaId: string, ref: string, correcao: string) {
    const config = await getEmpresaConfig(licencaId)

    const data = await this.focusNfeService.cartaCorrecao(
      config.focusEmpresaToken,
      ref,
      correcao,
      config.ambiente,
    )

    const statusFocus: string = data?.status || ''
    const resultado = {
      // Em 200 a Focus já transmitiu: o que não é "autorizado" é rejeição.
      status:         statusFocus === 'autorizado' ? 'autorizado' : 'erro_autorizacao',
      status_focus:   statusFocus,
      tipoDocumento:  MODULO_NFE,
      ambiente:       config.ambiente,
      ambienteNome:   nomeAmbiente(config.ambiente),
      numero_carta_correcao: numeroOuNulo(data?.numero_carta_correcao ?? data?.sequencia),
      protocolo:      data?.protocolo || data?.numero_protocolo || null,
      // Os arquivos da CARTA, não os da nota; as grafias da nota ficam como
      // alternativa pela mesma razão do `mapResultado`.
      url_pdf:        urlAbsolutaFocus(data?.caminho_pdf_carta_correcao ?? data?.caminho_danfe, config.ambiente),
      url_xml:        urlAbsolutaFocus(data?.caminho_xml_carta_correcao ?? data?.caminho_xml_nota_fiscal, config.ambiente),
      codigo_sefaz:   numeroOuNulo(data?.status_sefaz ?? data?.codigo_sefaz),
      mensagem_sefaz: (data?.mensagem_sefaz as string | undefined) || null,
    }

    if (resultado.status === 'autorizado') {
      this.logger.log(`Carta de correção nº ${resultado.numero_carta_correcao ?? '?'} da NFE ref "${ref}" AUTORIZADA pela SEFAZ.`)
    } else {
      this.logger.warn(
        `Carta de correção da NFE ref "${ref}" NÃO autorizada: status_focus="${statusFocus}"` +
        ` codigo_sefaz=${resultado.codigo_sefaz ?? 'nenhum'} — ${resultado.mensagem_sefaz ?? 'sem mensagem'}`,
      )
    }

    await this.registrarEvento({
      licencaId,
      ref,
      ambiente:  config.ambiente,
      tipoDocumento: MODULO_NFE,
      acao:      'CARTA_CORRECAO',
      resultado: resultado.status,
      mensagem:  resultado.mensagem_sefaz,
      codigoSefaz: resultado.codigo_sefaz,
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
    const config = await getEmpresaConfig(licencaId)

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

    const resultado = mapResultado(res, config.ambiente, tipoDocumento)

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
      codigoSefaz: resultado.codigo_sefaz,
    })

    return resultado
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
    acao:       'EMISSAO' | 'CANCELAMENTO' | 'INUTILIZACAO' | 'CARTA_CORRECAO'
    resultado:  string
    httpStatus?: number | null
    mensagem?:  string | null
    codigoSefaz?: number | null
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
          codigoSefaz: params.codigoSefaz ?? null,
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
}
