import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common'
import { ClienteService } from './cliente.service'

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
}
