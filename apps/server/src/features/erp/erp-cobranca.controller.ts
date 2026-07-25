import { Controller, Get, Post, Body, Param, Headers } from '@nestjs/common'
import { FinanceiroService } from '../financeiro/financeiro.service'
import { ErpContratacaoService } from './erp-contratacao.service'
import { Public } from '../../core/decorators/public.decorator'

@Public()
@Controller('erp')
export class ErpCobrancaController {
  constructor(
    private readonly financeiroService:  FinanceiroService,
    private readonly contratacaoService: ErpContratacaoService,
  ) {}

  @Post('cobranca')
  gerarCobranca(@Body() body: unknown, @Headers('origin') origin?: string) {
    return this.financeiroService.gerarCobranca(body, origin)
  }

  @Get('plano/:licencaId')
  planoPagamento(@Param('licencaId') licencaId: string) {
    return this.financeiroService.planoPagamento(licencaId)
  }

  // ── Contratação pública (site) ────────────────────────────────────────────

  /** Vitrine: planos marcados como públicos, com períodos e preços. */
  @Get('planos-publicos')
  planosPublicos() {
    return this.contratacaoService.planosPublicos()
  }

  /**
   * Cadastra o cliente e devolve a URL do checkout numa operação só.
   * O header Origin decide para onde o Stripe volta — validado contra allowlist.
   */
  @Post('contratar')
  contratar(@Body() body: unknown, @Headers('origin') origin?: string) {
    return this.contratacaoService.contratar(body, origin)
  }
}
