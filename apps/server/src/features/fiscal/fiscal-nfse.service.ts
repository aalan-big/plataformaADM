import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { MODULO_NFSE } from '@startbig/database'
import { FocusNfeService } from '../../common/focus-nfe/focus-nfe.service'
import { AMBIENTE_PRODUCAO, nomeAmbiente, urlAbsolutaFocus, numeroOuNulo, ResultadoNota, getEmpresaConfig } from './fiscal-comum'
import { FiscalCotaService } from './fiscal-cota.service'
import { FiscalEmissaoService } from './fiscal-emissao.service'
import { FiscalFranquiaService } from './fiscal-franquia.service'

/**
 * Resposta da NFS-e no MESMO contrato da NF-e (`ResultadoNota`), para o ERP ler
 * as duas do mesmo jeito, com o que só a NFS-e tem:
 * - `codigo_verificacao`: é com ele que o tomador confere a nota no portal;
 * - `codigo_erro`: os erros do Sistema Nacional são alfanuméricos ("E0014",
 *   "V999") e não cabem no `codigo_sefaz` numérico da NF-e.
 */
export type ResultadoNfse = ResultadoNota & {
  codigo_verificacao: string | null
  codigo_erro:        string | null
}

/**
 * Traduz a resposta de `/nfsen` (doc.focusnfe.com.br, consultar_nfse_nacional).
 *
 * `erro_autorizacao`, `negado` e `erro_cancelamento` viram `erro`; o cru fica em
 * `status_focus`, como na NF-e. O motivo vem em `erros[]` ({codigo, mensagem,
 * correcao}) e não em `mensagem_sefaz`: é montado aqui para o ERP mostrar sem
 * saber da diferença.
 */
export function mapResultadoNfse(data: any, ambiente: number): ResultadoNfse {
  const statusFocus = data?.status || ''
  const status =
    statusFocus === 'autorizado' ? 'autorizado'
    : statusFocus === 'processando_autorizacao' || statusFocus === 'processando' ? 'processando'
    : statusFocus === 'cancelado' ? 'cancelado'
    : 'erro'

  const erros = Array.isArray(data?.erros) ? data.erros : null
  const primeiro = erros?.[0]
  const mensagem = erros?.length
    ? erros.map((e: any) => [e?.codigo, e?.mensagem].filter(Boolean).join(' - ') + (e?.correcao ? ` (${e.correcao})` : '')).join(' | ')
    : data?.mensagem || null

  return {
    status,
    status_focus:   statusFocus,
    tipoDocumento:  MODULO_NFSE,
    ambiente,
    ambienteNome:   nomeAmbiente(ambiente),
    chave_acesso:   data?.chave_nfse || data?.chave_acesso || null,
    protocolo:      data?.protocolo || null,
    numero:         numeroOuNulo(data?.numero),
    serie:          numeroOuNulo(data?.serie_rps ?? data?.serie_dps),
    url_pdf:        urlAbsolutaFocus(data?.url_danfse ?? data?.caminho_danfse, ambiente),
    url_xml:        urlAbsolutaFocus(data?.caminho_xml_nota_fiscal, ambiente),
    qrcode:         null,
    url_consulta:   typeof data?.url === 'string' ? data.url : null,
    codigo_sefaz:   null,
    mensagem_sefaz: mensagem,
    erros,
    codigo_verificacao: data?.codigo_verificacao || null,
    codigo_erro:        primeiro?.codigo ? String(primeiro.codigo) : null,
  }
}

/**
 * NFS-e Nacional (docs/nfse-plano.md do ERP, F2): emitir, consultar e cancelar.
 *
 * Mesmas travas da NF-e, na mesma ordem — idempotência por cabeçalho, CNPJ do
 * prestador = ficha, cota só em produção, idempotência por `ref` na Focus — e
 * a mesma trilha (`EmissaoLog`), emprestada do `FiscalEmissaoService`. Fica num
 * serviço à parte para a NF-e não passar por nenhuma linha nova.
 *
 * Só a rota NACIONAL por enquanto: a municipal (`/nfse`) entra por cidade,
 * quando houver cliente (plano, §2).
 */
@Injectable()
export class FiscalNfseService {
  private readonly logger = new Logger(FiscalNfseService.name)

  constructor(
    private readonly focusNfeService: FocusNfeService,
    private readonly cota: FiscalCotaService,
    private readonly trilha: FiscalEmissaoService,
    private readonly franquia: FiscalFranquiaService,
  ) {}

  async emitir(licencaId: string, ref: string, payload: any, chaveIdempotencia?: string, confirmarDuplicidade = false): Promise<ResultadoNfse> {
    const config = await getEmpresaConfig(licencaId)

    const jaRespondido = await this.trilha.consultarIdempotencia(licencaId, chaveIdempotencia, 'EMISSAO', ref)
    if (jaRespondido) return jaRespondido as ResultadoNfse

    // O prestador tem de ser o CNPJ desta licença (mesma razão da NF-e).
    const cnpjPrestador = String(payload?.cnpj_prestador ?? '').replace(/\D/g, '')
    if (cnpjPrestador && cnpjPrestador !== config.cnpj) {
      this.logger.warn(`NFS-e barrada: licença ${licencaId} está configurada para o CNPJ ${config.cnpj} e a DPS veio com ${cnpjPrestador}.`)
      throw new BadRequestException('O CNPJ do prestador não corresponde à configuração fiscal desta licença.')
    }

    if (config.ambiente === AMBIENTE_PRODUCAO) {
      const uso = await this.cota.consumoMensal(licencaId, MODULO_NFSE, config)
      if (!uso.ilimitado && uso.restantes === 0) {
        this.logger.warn(`NFS-e barrada por cota: licença ${licencaId} usou ${uso.emitidas}/${uso.cota} em ${uso.competencia}.`)
        throw new HttpException(
          `Cota de ${uso.cota} documentos (${MODULO_NFSE}) deste mês esgotada (${uso.emitidas} emitidos). Contrate notas adicionais ou aguarde a virada do mês.`,
          HttpStatus.PAYMENT_REQUIRED,
        )
      }
      await this.franquia.exigirEspaco(licencaId)
    }

    const assinatura = await this.franquia.conferirDuplicata(licencaId, config.ambiente, MODULO_NFSE, ref, payload, confirmarDuplicidade)

    // Idempotência por ref: a mesma da NF-e — na dúvida, não emite.
    try {
      const existente = await this.focusNfeService.consultarNfsen(config.focusEmpresaToken, ref, config.ambiente)
      if (existente?.status && existente.status !== 'nao_encontrado') {
        this.logger.log(`NFS-e ref "${ref}" já enviada anteriormente. Retornando status existente.`)
        const jaEmitida = mapResultadoNfse(existente, config.ambiente)
        await this.trilha.gravarIdempotencia({ licencaId, chave: chaveIdempotencia, operacao: 'EMISSAO', ref, resultado: jaEmitida })
        return jaEmitida
      }
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : 0
      if (status !== 404) {
        this.logger.error(`Idempotência indeterminada para a NFS-e ref "${ref}" (HTTP ${status || 'sem status'}): emissão abortada por segurança.`)
        throw new HttpException(
          'Não foi possível confirmar na Focus NFe se esta nota já existe. Nenhuma nota foi emitida — tente novamente em instantes.',
          HttpStatus.SERVICE_UNAVAILABLE,
        )
      }
    }

    const res = await this.focusNfeService.emitirNfsen(config.focusEmpresaToken, ref, payload, config.ambiente)
    const resultado = mapResultadoNfse(res, config.ambiente)
    this.logarDesfecho(ref, resultado, 'emissão')

    const contou = resultado.status === 'autorizado' || resultado.status === 'processando'
    if (contou) {
      await this.cota.incrementarConsumo(licencaId, config.ambiente, MODULO_NFSE, 'emitidas')
    }
    await this.trilha.gravarIdempotencia({ licencaId, chave: chaveIdempotencia, operacao: 'EMISSAO', ref, resultado })
    await this.trilha.registrarEvento({
      licencaId, ref, ambiente: config.ambiente, tipoDocumento: MODULO_NFSE,
      acao: 'EMISSAO', resultado: resultado.status, mensagem: resultado.mensagem_sefaz,
      assinatura,
    })
    if (contou && config.ambiente === AMBIENTE_PRODUCAO) await this.franquia.aposEmitir(licencaId)
    return resultado
  }

  /** Não grava a nota (quem guarda é a Focus); grava só o desfecho, uma vez. */
  async consultar(licencaId: string, ref: string): Promise<ResultadoNfse> {
    const config = await getEmpresaConfig(licencaId)
    let res: any
    try {
      res = await this.focusNfeService.consultarNfsen(config.focusEmpresaToken, ref, config.ambiente)
    } catch (erro) {
      // Mesmo código da NF-e: só ele autoriza o ERP a concluir que a nota não chegou.
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

    const resultado = mapResultadoNfse(res, config.ambiente)
    if (resultado.status !== 'processando') this.logarDesfecho(ref, resultado, 'consulta')
    await this.trilha.registrarDesfechoDaConsulta(licencaId, ref, config.ambiente, MODULO_NFSE, resultado)
    return resultado
  }

  async cancelar(licencaId: string, ref: string, justificativa: string): Promise<ResultadoNfse> {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new BadRequestException('A justificativa de cancelamento deve conter no mínimo 15 caracteres.')
    }
    const config = await getEmpresaConfig(licencaId)
    const res = await this.focusNfeService.cancelarNfsen(config.focusEmpresaToken, ref, justificativa, config.ambiente)
    const resultado = mapResultadoNfse(res, config.ambiente)

    // Cancelar não devolve cota (a nota existiu), como na NF-e.
    if (resultado.status === 'cancelado') {
      await this.cota.incrementarConsumo(licencaId, config.ambiente, MODULO_NFSE, 'canceladas')
    }
    await this.trilha.registrarEvento({
      licencaId, ref, ambiente: config.ambiente, tipoDocumento: MODULO_NFSE,
      acao: 'CANCELAMENTO', resultado: resultado.status, mensagem: resultado.mensagem_sefaz,
    })
    return resultado
  }

  private logarDesfecho(ref: string, r: ResultadoNfse, momento: string) {
    if (r.status === 'autorizado') {
      this.logger.log(`NFSE ref "${ref}" AUTORIZADA (${momento}): número ${r.numero ?? '?'}, verificação ${r.codigo_verificacao ?? '?'}.`)
    } else if (r.status === 'processando') {
      this.logger.log(`NFSE ref "${ref}" em processamento no Sistema Nacional.`)
    } else {
      this.logger.warn(`NFSE ref "${ref}" com status "${r.status_focus}" (${momento}): ${r.mensagem_sefaz ?? 'sem mensagem'}`)
    }
  }
}
