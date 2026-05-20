/**
 * ============================================================================
 * NOME DO ARQUIVO: usuario.controller.ts
 * MÓDULO: USUARIO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como o "garçom" da API para o módulo de USUARIO. Ele recebe as
 * requisições HTTP (GET, POST, PATCH, DELETE) vindas do frontend ou do ERP
 * e as direciona para o Service correspondente processar.
 * 
 * O QUE ELE CONTÉM:
 * - Rotas e Endpoints da API.
 * - Validação básica de entrada de dados (DTOs).
 * - Respostas HTTP formatadas para o cliente.
 * ============================================================================
 */
import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common'
import { UsuarioService } from './usuario.service'
import { Roles } from '../../core/decorators/roles.decorator'

@Roles('ADMIN')
@Controller('usuario')
export class UsuarioController {
  constructor(private readonly usuarioService: UsuarioService) {}

  @Get()
  async listar() {
    return this.usuarioService.listar()
  }

  @Post()
  async criar(@Body() body: any) {
    return this.usuarioService.criar(body)
  }

  @Put(':id')
  async editar(@Param('id') id: string, @Body() body: any) {
    return this.usuarioService.editar(id, body)
  }

  @Delete(':id')
  async deletar(@Param('id') id: string) {
    return this.usuarioService.deletar(id)
  }
}
