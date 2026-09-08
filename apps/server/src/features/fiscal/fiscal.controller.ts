import { Controller, Get, Post, Body, Req, Query, Headers, UseGuards, BadRequestException } from '@nestjs/common'
import { Request } from 'express'
import { FiscalService, TipoDocumentoEmissivel } from './fiscal.service'
import { ErpLicencaGuard } from '../../core/guards/erp-licenca.guard'
import { ModuloGuard } from '../../core/guards/modulo.guard'
import { Public } from '../../core/decorators/public.decorator'
import { RequerModulo } from '../../core/decorators/requer-modulo.decorator'
import { MODULO_NFE, MODULO_NFCE } from '@startbig/database'
import { refNotaSchema, chaveIdempotenciaSchema, emitirNotaSchema, cancelarNotaSchema, inutilizarSchema } from '@startbig/schemas'
import { ZodError } from 'zod'

type ReqErp = Request & { erp: { licencaId: string } }

/**
 * Parte comum das rotas fiscais do ERP.
 *
 * NF-e e NFC-e são o mesmo fluxo com um tipo de documento diferente, e o que
 * muda entre elas — caminho, módulo exigido e cota — já está declarado nos
 * decorators de cada controller. Duplicar os métodos daria duas cópias do
 * tratamento de erro e da leitura do cabeçalho de idempotência para divergirem
 * com o tempo.
 */
abstract class FiscalErpControllerBase {
  constructor(protected readonly fiscalService: FiscalService) {}

  /** NFE ou NFCE — o mesmo valor do módulo exigido pelo controller concreto. */
  protected abstract get tipoDocumento(): TipoDocumentoEmissivel

  protected parse<T>(schema: { parse: (x: unknown) => T }, valor: unknown): T {
    try {
      return schema.parse(valor)
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          erro: 'Estrutura JSON inválida',
          detalhes: e.issues.map(issue => ({
            campo: issue.path.join('.'),
            mensagem: issue.message
          }))
        })
      }
      throw e
    }
  }

  /**
   * O `X-Idempotency-Key` do ERP, quando enviado.
   *
   * Opcional de propósito: era ignorado até agora, e exigi-lo de repente
   * recusaria a emissão de todo ERP em campo. Ausente, a `ref` continua sendo a
   * trava — que é o que protege a emissão. Presente, vira a segunda camada.
   */
  protected chave(valor?: string): string | undefined {
    if (valor === undefined || valor === null || valor.trim() === '') return undefined
    return this.parse(chaveIdempotenciaSchema, valor)
  }

  @Post('emitir')
  emitir(
    @Req() req: ReqErp,
    @Body() body: unknown,
    @Headers('x-idempotency-key') chaveIdempotencia?: string,
  ) {
    const dados = this.parse(emitirNotaSchema, body)
    return this.fiscalService.emitir(
      req.erp.licencaId,
      dados.ref,
      dados.payload,
      this.tipoDocumento,
      this.chave(chaveIdempotencia),
    )
  }

  @Get('consultar')
  consultar(
    @Req() req: ReqErp,
    @Query('ref') ref: unknown
  ) {
    const refValida = this.parse(refNotaSchema, ref)
    return this.fiscalService.consultar(req.erp.licencaId, refValida, this.tipoDocumento)
  }

  @Post('cancelar')
  cancelar(
    @Req() req: ReqErp,
    @Body() body: unknown
  ) {
    const dados = this.parse(cancelarNotaSchema, body)
    return this.fiscalService.cancelar(req.erp.licencaId, dados.ref, dados.justificativa, this.tipoDocumento)
  }

  /**
   * Inutiliza uma faixa de numeração que não virou nota.
   *
   * Sem `ref`: o evento é identificado pela própria faixa. O CNPJ NÃO vem do
   * corpo — sai da configuração da licença, como na emissão, porque inutilizar
   * numeração de outro emitente é um evento que a SEFAZ registra e ninguém
   * desfaz.
   */
  @Post('inutilizar')
  inutilizar(
    @Req() req: ReqErp,
    @Body() body: unknown,
    @Headers('x-idempotency-key') chaveIdempotencia?: string,
  ) {
    const dados = this.parse(inutilizarSchema, body)
    return this.fiscalService.inutilizar(
      req.erp.licencaId,
      dados,
      this.tipoDocumento,
      this.chave(chaveIdempotencia),
    )
  }

  /**
   * Quanto desta licença já foi usado no mês.
   *
   * Existe para o ERP conseguir avisar o operador ANTES de ele montar a nota
   * inteira e levar um 402 no envio. Não é trava: quem barra de verdade é o
   * `emitir`, no servidor, porque toda emissão passa por aqui de qualquer jeito.
   *
   * Devolve também o ambiente vigente, decidido pela plataforma — é o que
   * permite ao ERP mostrar "Homologação" ou "Produção" sem chutar.
   */
  @Get('consumo')
  consumo(@Req() req: ReqErp) {
    return this.fiscalService.consumoMensal(req.erp.licencaId, this.tipoDocumento)
  }
}

/**
 * A ordem dos guards importa: `ErpLicencaGuard` valida o JWT e preenche
 * `request.erp`, e só então o `ModuloGuard` tem o que ler. Invertidos, o
 * segundo não acharia licença nenhuma.
 *
 * O `RequerModulo` fica AQUI, no controller do fiscal, e não no
 * `ErpLicencaGuard`: aquele protege todas as rotas `/erp/*`, e mexer nele
 * colocaria uma trava de módulo no caminho de conectar, validar e heartbeat de
 * toda a base.
 */
@Public()
@UseGuards(ErpLicencaGuard, ModuloGuard)
@RequerModulo(MODULO_NFE)
@Controller('erp/fiscal/nfe')
export class FiscalController extends FiscalErpControllerBase {
  constructor(fiscalService: FiscalService) { super(fiscalService) }
  protected get tipoDocumento(): TipoDocumentoEmissivel { return MODULO_NFE }
}

/**
 * NFC-e: mesmo fluxo, módulo próprio.
 *
 * Exige `NFCE` e não `NFE` porque são produtos separados no catálogo, com cota
 * separada no contador — quem vende só mercadoria no balcão não deveria pagar
 * pelos dois, e uma NFC-e emitida não pode comer a cota de NF-e do cliente.
 */
@Public()
@UseGuards(ErpLicencaGuard, ModuloGuard)
@RequerModulo(MODULO_NFCE)
@Controller('erp/fiscal/nfce')
export class FiscalNfceController extends FiscalErpControllerBase {
  constructor(fiscalService: FiscalService) { super(fiscalService) }
  protected get tipoDocumento(): TipoDocumentoEmissivel { return MODULO_NFCE }
}

/**
 * O estado fiscal desta licença, para a tela do ERP.
 *
 * Fora dos controllers acima, e sem `RequerModulo`, de propósito: é justamente
 * o ERP que ainda NÃO consegue emitir que mais precisa desta resposta — para
 * mostrar o ambiente vigente e o que falta configurar, em vez de deixar o
 * lojista descobrir no erro da primeira nota.
 *
 * Não devolve segredo nenhum: nem o token da Focus, nem o CSC — que a
 * plataforma não guarda, porque ele fica no cadastro da empresa na Focus.
 */
@Public()
@UseGuards(ErpLicencaGuard)
@Controller('erp/fiscal')
export class FiscalConfigController {
  constructor(private readonly fiscalService: FiscalService) {}

  @Get('config')
  config(@Req() req: ReqErp) {
    return this.fiscalService.configFiscal(req.erp.licencaId)
  }
}
