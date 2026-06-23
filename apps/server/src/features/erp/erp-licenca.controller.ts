import { Controller, Get, Post, Body } from '@nestjs/common'
import { DispositivoService } from '../dispositivos/dispositivo.service'
import { ErpAuthService } from './erp-auth.service'
import { Public } from '../../core/decorators/public.decorator'

@Public()
@Controller('erp')
export class ErpLicencaController {
  constructor(
    private readonly dispositivoService: DispositivoService,
    private readonly erpAuthService:     ErpAuthService,
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
}
