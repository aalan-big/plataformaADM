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
  async autoCadastro(@Body() body: unknown) {
    const resultado = await this.dispositivoService.autoCadastro(body)
    // Não-crítico: falha no e-mail/token não deve derrubar o cadastro
    this.erpAuthService.enviarEmailPrimeiroAcesso(
      resultado.clienteId,
      (body as any).email,
      (body as any).nomeOuRazao,
    ).catch(err => console.warn('[erp] enviarEmailPrimeiroAcesso falhou:', err?.message ?? err))
    return resultado
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
