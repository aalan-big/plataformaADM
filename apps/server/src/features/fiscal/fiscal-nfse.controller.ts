import { Controller, Get, Post, Body, Req, Query, Headers, UseGuards, BadRequestException } from '@nestjs/common'
import { Request } from 'express'
import { ZodError } from 'zod'
import { MODULO_NFSE } from '@startbig/database'
import { refNotaSchema, chaveIdempotenciaSchema, emitirNfseSchema, cancelarNotaSchema } from '@startbig/schemas'
import { FiscalNfseService } from './fiscal-nfse.service'
import { FiscalCotaService } from './fiscal-cota.service'
import { confirmouDuplicidade } from './fiscal.controller'
import { ErpLicencaGuard } from '../../core/guards/erp-licenca.guard'
import { ModuloGuard } from '../../core/guards/modulo.guard'
import { Public } from '../../core/decorators/public.decorator'
import { RequerModulo } from '../../core/decorators/requer-modulo.decorator'

type ReqErp = Request & { erp: { licencaId: string; modulos?: string[] } }

/**
 * NFS-e: as rotas que o ERP chama (docs/nfse-plano.md, F2). Módulo e cota
 * próprios (`NFSE`), como a NFC-e.
 *
 * Não herda do `FiscalErpControllerBase` da NF-e de propósito: a NFS-e não tem
 * inutilização nem carta de correção, e herdar abriria essas rotas aqui. O
 * contrato do corpo é o mesmo (`{ref, payload}`, `{ref, justificativa}`), e as
 * respostas seguem o `ResultadoNota` — o ERP lê as notas do mesmo jeito.
 */
@Public()
@UseGuards(ErpLicencaGuard, ModuloGuard)
@RequerModulo(MODULO_NFSE)
@Controller('erp/fiscal/nfse')
export class FiscalNfseController {
  constructor(
    private readonly nfse: FiscalNfseService,
    private readonly cota: FiscalCotaService,
  ) {}

  /** Mesma validação da NF-e: devolve o campo e a mensagem, nunca o valor. */
  private parse<T>(schema: { parse: (x: unknown) => T }, valor: unknown): T {
    try {
      return schema.parse(valor)
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          erro: 'Estrutura JSON inválida',
          detalhes: e.issues.map(issue => ({ campo: issue.path.join('.'), mensagem: issue.message })),
        })
      }
      throw e
    }
  }

  private chave(valor?: string): string | undefined {
    if (valor === undefined || valor === null || valor.trim() === '') return undefined
    return this.parse(chaveIdempotenciaSchema, valor)
  }

  @Post('emitir')
  emitir(
    @Req() req: ReqErp,
    @Body() body: unknown,
    @Headers('x-idempotency-key') chaveIdempotencia?: string,
    @Headers('x-confirmar-duplicidade') confirmar?: string,
  ) {
    const dados = this.parse(emitirNfseSchema, body)
    return this.nfse.emitir(req.erp.licencaId, dados.ref, dados.payload, this.chave(chaveIdempotencia), confirmouDuplicidade(confirmar))
  }

  @Get('consultar')
  consultar(@Req() req: ReqErp, @Query('ref') ref: unknown) {
    return this.nfse.consultar(req.erp.licencaId, this.parse(refNotaSchema, ref))
  }

  @Post('cancelar')
  cancelar(@Req() req: ReqErp, @Body() body: unknown) {
    const dados = this.parse(cancelarNotaSchema, body)
    return this.nfse.cancelar(req.erp.licencaId, dados.ref, dados.justificativa)
  }

  @Get('consumo')
  consumo(@Req() req: ReqErp) {
    return this.cota.consumoMensal(req.erp.licencaId, MODULO_NFSE)
  }
}
