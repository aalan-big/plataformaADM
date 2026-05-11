import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common'
import { UsuarioService } from './usuario.service'

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
