/**
 * ============================================================================
 * NOME DO ARQUIVO: dispositivo.controller.ts
 * MÓDULO: DISPOSITIVOS
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como o "garçom" da API para o módulo de DISPOSITIVOS. Ele recebe as
 * requisições HTTP (GET, POST, PATCH, DELETE) vindas do frontend ou do ERP
 * e as direciona para o Service correspondente processar.
 * 
 * O QUE ELE CONTÉM:
 * - Rotas e Endpoints da API.
 * - Validação básica de entrada de dados (DTOs).
 * - Respostas HTTP formatadas para o cliente.
 * ============================================================================
 */
import { Controller, Post, Patch, Get, Delete, Param, Body, Query } from '@nestjs/common'
import { DispositivoService } from './dispositivo.service'
import { Public } from '../../core/decorators/public.decorator'

@Controller('licenca')
export class DispositivoController {
  constructor(private readonly dispositivoService: DispositivoService) {}

  // Ordem importa: rotas fixas antes de parâmetros dinâmicos
  @Public()
  @Get('chave-publica')
  getChavePublica() {
    return { publicKey: this.dispositivoService.getPublicKey() }
  }

  @Get('planos')
  async listarPlanos() {
    const data = await this.dispositivoService.listarPlanos()
    return { data }
  }

  @Get('alertas')
  async alertasVencimento(@Query('dias') dias?: string) {
    const data = await this.dispositivoService.listarAlertasVencimento(dias ? Number(dias) : 30)
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

  @Delete(':id')
  async deletar(@Param('id') id: string) {
    return this.dispositivoService.deletarLicenca(id)
  }

  @Public()
  @Post('auto-cadastro')
  async autoCadastro(@Body() body: unknown) {
    return this.dispositivoService.autoCadastro(body)
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

  @Patch(':id/remover-extra')
  async removerExtra(@Param('id') id: string) {
    return this.dispositivoService.removerUsuarioExtra(id)
  }

  @Patch(':id/bloquear')
  async bloquear(@Param('id') id: string) {
    return this.dispositivoService.bloquear(id)
  }

  @Patch(':id/suspender')
  async suspender(@Param('id') id: string) {
    return this.dispositivoService.suspender(id)
  }

  @Patch(':id/revogar')
  async revogar(@Param('id') id: string) {
    return this.dispositivoService.revogar(id)
  }

  @Patch(':id/reativar')
  async reativar(@Param('id') id: string) {
    return this.dispositivoService.reativar(id)
  }

  @Patch(':id/trocar-dispositivo')
  async trocarDispositivo(@Param('id') id: string) {
    return this.dispositivoService.trocarDispositivo(id)
  }
}
