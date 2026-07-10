/**
 * ============================================================================
 * NOME DO ARQUIVO: financeiro.controller.ts
 * MÓDULO: FINANCEIRO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como o "garçom" da API para o módulo de FINANCEIRO. Ele recebe as
 * requisições HTTP (GET, POST, PATCH, DELETE) vindas do frontend ou do ERP
 * e as direciona para o Service correspondente processar.
 * 
 * O QUE ELE CONTÉM:
 * - Rotas e Endpoints da API.
 * - Validação básica de entrada de dados (DTOs).
 * - Respostas HTTP formatadas para o cliente.
 * ============================================================================
 */
import { Controller, Post, Get, Body, Param, Query, Headers, RawBodyRequest, Req } from '@nestjs/common'
import { Request } from 'express'
import { FinanceiroService } from './financeiro.service'
import { Public } from '../../core/decorators/public.decorator'
import { Roles } from '../../core/decorators/roles.decorator'

@Roles('ADMIN')
@Controller('financeiro')
export class FinanceiroController {
  constructor(private readonly financeiroService: FinanceiroService) {}

  // ── Dashboard ─────────────────────────────────────────────────────────────

  @Get('resumo')
  async resumo() {
    return { data: await this.financeiroService.resumo() }
  }

  @Get('inadimplentes')
  async inadimplentes(@Query('dias') dias?: string) {
    return { data: await this.financeiroService.inadimplentes(dias ? Number(dias) : undefined) }
  }

  @Get('pagamentos')
  async pagamentos(
    @Query('ano')     ano?: string,
    @Query('mes')     mes?: string,
    @Query('gateway') gateway?: string,
    @Query('q')       q?: string,
  ) {
    return { data: await this.financeiroService.pagamentos({ ano, mes, gateway, q }) }
  }

  // ── Receita ───────────────────────────────────────────────────────────────

  @Get('receita')
  async receita(@Query('ano') ano: string, @Query('mes') mes: string) {
    const agora = new Date()
    return this.financeiroService.receitaMes(
      Number(ano) || agora.getFullYear(),
      Number(mes) || agora.getMonth() + 1,
    )
  }

  // ── Histórico ─────────────────────────────────────────────────────────────

  @Get('historico/cliente/:clienteId')
  async historicoCliente(@Param('clienteId') clienteId: string) {
    return { data: await this.financeiroService.historicoCliente(clienteId) }
  }

  @Get('historico/licenca/:licencaId')
  async historicoLicenca(@Param('licencaId') licencaId: string) {
    return { data: await this.financeiroService.historicoLicenca(licencaId) }
  }

  @Get('transacoes/cliente/:clienteId')
  async transacoesCliente(@Param('clienteId') clienteId: string) {
    return { data: await this.financeiroService.transacoesCliente(clienteId) }
  }

  @Get('transacoes/licenca/:licencaId')
  async transacoesLicenca(@Param('licencaId') licencaId: string) {
    return { data: await this.financeiroService.transacoesLicenca(licencaId) }
  }

  // ── Pagamento manual ─────────────────────────────────────────────────────

  @Post('confirmar')
  async confirmar(@Body() body: unknown) {
    return this.financeiroService.confirmarPagamentoManual(body)
  }

  // ── Stripe Checkout ──────────────────────────────────────────────────────

  @Public()
  @Get('plano/:licencaId')
  async planoPagamento(@Param('licencaId') licencaId: string) {
    return this.financeiroService.planoPagamento(licencaId)
  }

  @Public()
  @Post('cobranca')
  async gerarCobranca(@Body() body: unknown) {
    return this.financeiroService.gerarCobranca(body)
  }

  @Public()
  @Post('webhook/stripe')
  async webhookStripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    return this.financeiroService.webhookStripe(req.rawBody!, sig)
  }

  // ── Webhook Asaas ────────────────────────────────────────────────────────

  @Public()
  @Post('webhook/asaas')
  async webhookAsaas(@Body() body: unknown) {
    return this.financeiroService.webhookAsaas(body)
  }
}
