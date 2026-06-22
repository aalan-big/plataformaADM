/**
 * ============================================================================
 * NOME DO ARQUIVO: cliente.controller.ts
 * MÓDULO: CLIENTE
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como o "garçom" da API para o módulo de CLIENTE. Ele recebe as
 * requisições HTTP (GET, POST, PATCH, DELETE) vindas do frontend ou do ERP
 * e as direciona para o Service correspondente processar.
 * 
 * O QUE ELE CONTÉM:
 * - Rotas e Endpoints da API.
 * - Validação básica de entrada de dados (DTOs).
 * - Respostas HTTP formatadas para o cliente.
 * ============================================================================
 */
import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common'
import { ClienteService } from './cliente.service'
import { Roles } from '../../core/decorators/roles.decorator'

@Roles('ADMIN')
@Controller('clientes')
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  @Get()
  async listar(@Query('q') q?: string) {
    if (q) return this.clienteService.pesquisarClientes(q)
    return this.clienteService.listarClientes()
  }

  @Get(':id')
  async buscar(@Param('id') id: string) {
    return this.clienteService.buscarCliente(id)
  }

  @Post()
  async registrar(@Body() body: unknown) {
    return this.clienteService.registrar(body)
  }

  @Patch(':id')
  async editar(@Param('id') id: string, @Body() body: unknown) {
    return this.clienteService.editar(id, body)
  }

  @Patch(':id/desativar')
  async desativar(@Param('id') id: string) {
    return this.clienteService.desativar(id)
  }

  @Delete('limpar-debug')
  async limparDebug() {
    return this.clienteService.limparTodosDebug()
  }
}
