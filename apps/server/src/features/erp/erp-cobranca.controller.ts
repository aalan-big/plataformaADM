import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { FinanceiroService } from '../financeiro/financeiro.service'
import { Public } from '../../core/decorators/public.decorator'

@Public()
@Controller('erp')
export class ErpCobrancaController {
  constructor(private readonly financeiroService: FinanceiroService) {}

  @Post('cobranca')
  gerarCobranca(@Body() body: unknown) {
    return this.financeiroService.gerarCobranca(body)
  }

  @Get('plano/:licencaId')
  planoPagamento(@Param('licencaId') licencaId: string) {
    return this.financeiroService.planoPagamento(licencaId)
  }
}
