/**
 * ============================================================================
 * NOME DO ARQUIVO: parceiro.controller.ts
 * MÓDULO: PARCEIRO
 * ============================================================================
 * Rotas do programa de parceiros: cadastro, vínculo de clientes, consulta de
 * comissões e baixa de repasse. Tudo restrito a ADMIN.
 * ============================================================================
 */
import { Controller, Get, Post, Put, Patch, Body, Param, Query } from '@nestjs/common'
import { ParceiroService } from './parceiro.service'
import { Roles } from '../../core/decorators/roles.decorator'

@Roles('ADMIN')
@Controller('parceiro')
export class ParceiroController {
  constructor(private readonly parceiroService: ParceiroService) {}

  // ── Cadastro ──────────────────────────────────────────────────────────────

  @Get()
  async listar(@Query('status') status?: string, @Query('q') q?: string) {
    return { data: await this.parceiroService.listar({ status, q }) }
  }

  @Get('comissoes')
  async comissoes(
    @Query('parceiroId')  parceiroId?: string,
    @Query('status')      status?: string,
    @Query('competencia') competencia?: string,
  ) {
    return { data: await this.parceiroService.listarComissoes({ parceiroId, status, competencia }) }
  }

  /** Quanto pagar a cada parceiro numa competência (padrão: pendentes). */
  @Get('repasse')
  async repasse(@Query('competencia') competencia?: string, @Query('status') status?: string) {
    return { data: await this.parceiroService.repasse({ competencia, status }) }
  }

  @Get(':id')
  async buscar(@Param('id') id: string) {
    return { data: await this.parceiroService.buscarPorId(id) }
  }

  @Post()
  async criar(@Body() body: unknown) {
    return this.parceiroService.criar(body)
  }

  @Put(':id')
  async editar(@Param('id') id: string, @Body() body: unknown) {
    return this.parceiroService.editar(id, body)
  }

  @Patch(':id/desativar')
  async desativar(@Param('id') id: string) {
    return this.parceiroService.alterarStatus(id, 'INATIVO')
  }

  @Patch(':id/reativar')
  async reativar(@Param('id') id: string) {
    return this.parceiroService.alterarStatus(id, 'ATIVO')
  }

  // ── Vínculo e repasse ─────────────────────────────────────────────────────

  /** Liga (ou desliga, com parceiroId null) um cliente a um parceiro. */
  @Patch('vincular-cliente')
  async vincularCliente(@Body() body: unknown) {
    return this.parceiroService.vincularCliente(body)
  }

  /** Baixa de repasse: marca as comissões selecionadas como PAGA. */
  @Post('comissoes/pagar')
  async pagarComissoes(@Body() body: unknown) {
    return this.parceiroService.pagarComissoes(body)
  }
}
