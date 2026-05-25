/**
 * ============================================================================
 * NOME DO ARQUIVO: plano.controller.ts
 * MÓDULO: PLANO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como o "garçom" da API para o módulo de PLANO. Ele recebe as
 * requisições HTTP (GET, POST, PUT, PATCH) vindas do frontend ou do ERP
 * e as direciona para o Service correspondente processar.
 *
 * O QUE ELE CONTÉM:
 * - Rotas e Endpoints da API.
 * - Validação básica de entrada de dados (DTOs).
 * - Respostas HTTP formatadas para o cliente.
 * ============================================================================
 */
import { Controller, Get, Post, Put, Patch, Body, Param } from '@nestjs/common'
import { PlanoService } from './plano.service'
import { Roles } from '../../core/decorators/roles.decorator'

@Roles('ADMIN')
@Controller('plano')
export class PlanoController {
  constructor(private readonly planoService: PlanoService) {}

  @Get()
  async listar() {
    const data = await this.planoService.listar()
    return { data }
  }

  @Get(':id')
  async buscarPorId(@Param('id') id: string) {
    const data = await this.planoService.buscarPorId(id)
    return { data }
  }

  @Post()
  async criar(@Body() body: unknown) {
    return this.planoService.criar(body)
  }

  @Put(':id')
  async editar(@Param('id') id: string, @Body() body: unknown) {
    return this.planoService.editar(id, body)
  }

  @Patch(':id/desativar')
  async desativar(@Param('id') id: string) {
    return this.planoService.desativar(id)
  }

  @Patch(':id/reativar')
  async reativar(@Param('id') id: string) {
    return this.planoService.reativar(id)
  }
}
