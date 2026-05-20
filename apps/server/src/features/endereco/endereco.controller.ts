/**
 * ============================================================================
 * NOME DO ARQUIVO: endereco.controller.ts
 * MÓDULO: ENDERECO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como o "garçom" da API para o módulo de ENDERECO. Ele recebe as
 * requisições HTTP (GET, POST, PATCH, DELETE) vindas do frontend ou do ERP
 * e as direciona para o Service correspondente processar.
 * 
 * O QUE ELE CONTÉM:
 * - Rotas e Endpoints da API.
 * - Validação básica de entrada de dados (DTOs).
 * - Respostas HTTP formatadas para o cliente.
 * ============================================================================
 */
import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common'
import { EnderecoService } from './endereco.service'

@Controller('endereco')
export class EnderecoController {
  constructor(private readonly enderecoService: EnderecoService) {}

  @Get()
  async listar(@Query('clienteId') clienteId: string) {
    return this.enderecoService.listar(clienteId)
  }

  @Post()
  async adicionar(@Body() body: any) {
    return this.enderecoService.adicionar(body)
  }

  @Put(':id')
  async editar(@Param('id') id: string, @Body() body: any) {
    return this.enderecoService.editar(id, body)
  }

  @Delete(':id')
  async remover(@Param('id') id: string) {
    return this.enderecoService.remover(id)
  }
}
