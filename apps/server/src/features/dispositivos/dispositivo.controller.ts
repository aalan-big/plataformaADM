import { Controller, Post, Patch, Get, Param, Body, Query } from '@nestjs/common'
import { DispositivoService } from './dispositivo.service'
import { Public } from '../../core/decorators/public.decorator'

@Controller('licenca')
export class DispositivoController {
  constructor(private readonly dispositivoService: DispositivoService) {}

  // Ordem importa: rotas fixas antes de parâmetros dinâmicos
  @Get('planos')
  async listarPlanos() {
    const data = await this.dispositivoService.listarPlanos()
    return { data }
  }

  @Get()
  async listarTodas(
    @Query('status')  status?: string,
    @Query('isTrial') isTrial?: string,
    @Query('q')       q?: string,
  ) {
    const data = await this.dispositivoService.listarTodas({ status, isTrial, q })
    return { data }
  }

  @Post()
  async criar(@Body() body: unknown) {
    return this.dispositivoService.criarLicenca(body)
  }

  @Get('cliente/:clienteId')
  async listarPorCliente(@Param('clienteId') clienteId: string) {
    const data = await this.dispositivoService.buscarPorCliente(clienteId)
    return { data }
  }

  @Get(':id')
  async buscarPorId(@Param('id') id: string) {
    const data = await this.dispositivoService.buscarPorId(id)
    return { data }
  }

  @Public()
  @Post('conectar')
  async conectar(@Body() body: unknown) {
    return this.dispositivoService.conectar(body)
  }

  @Public()
  @Post('desconectar')
  async desconectar(@Body() body: unknown) {
    return this.dispositivoService.desconectar(body)
  }

  @Public()
  @Post('heartbeat')
  async heartbeat(@Body() body: unknown) {
    return this.dispositivoService.heartbeat(body)
  }

  @Public()
  @Post('validar')
  async validar(@Body() body: unknown) {
    return this.dispositivoService.validar(body)
  }

  @Post(':id/renovar')
  async renovar(@Param('id') id: string, @Body() body: unknown) {
    return this.dispositivoService.renovar(id, body)
  }

  @Patch(':id/resetar-usuarios')
  async resetarUsuarios(@Param('id') id: string) {
    return this.dispositivoService.resetarContadorUsuarios(id)
  }

  @Patch(':id/adicionar-extra')
  async adicionarExtra(@Param('id') id: string) {
    return this.dispositivoService.adicionarUsuarioExtra(id)
  }

  @Patch(':id/bloquear')
  async bloquear(@Param('id') id: string) {
    return this.dispositivoService.bloquear(id)
  }

  @Patch(':id/reativar')
  async reativar(@Param('id') id: string) {
    return this.dispositivoService.reativar(id)
  }
}
