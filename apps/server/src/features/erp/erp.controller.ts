import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { DispositivoService } from '../dispositivos/dispositivo.service'
import { FinanceiroService } from '../financeiro/financeiro.service'
import { Public } from '../../core/decorators/public.decorator'

@Public()
@Controller('erp')
export class ErpController {
  constructor(
    private readonly dispositivoService: DispositivoService,
    private readonly financeiroService:  FinanceiroService,
  ) {}

  @Get('chave-publica')
  getChavePublica() {
    return { publicKey: this.dispositivoService.getPublicKey() }
  }

  @Post('auto-cadastro')
  autoCadastro(@Body() body: unknown) {
    return this.dispositivoService.autoCadastro(body)
  }

  @Post('conectar')
  conectar(@Body() body: unknown) {
    return this.dispositivoService.conectar(body)
  }

  @Post('desconectar')
  desconectar(@Body() body: unknown) {
    return this.dispositivoService.desconectar(body)
  }

  @Post('heartbeat')
  heartbeat(@Body() body: unknown) {
    return this.dispositivoService.heartbeat(body)
  }

  @Post('validar')
  validar(@Body() body: unknown) {
    return this.dispositivoService.validar(body)
  }

  @Post('cobranca')
  cobranca(@Body() body: unknown) {
    return this.financeiroService.gerarCobranca(body)
  }

  @Get('plano/:licencaId')
  plano(@Param('licencaId') licencaId: string) {
    return this.financeiroService.planoPagamento(licencaId)
  }
}
