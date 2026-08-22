/**
 * ============================================================================
 * NOME DO ARQUIVO: renovacao.controller.ts
 * MÓDULO: RENOVAÇÃO
 * ============================================================================
 * As rotas que o ERP local chama para renovar a assinatura.
 *
 * Vivem sob `licenca/renovacao` — dois segmentos de propósito. O controller de
 * dispositivos já responde por `licenca` e tem um `@Get(':id')` curinga; um
 * caminho de um segmento só seria engolido por ele dependendo da ordem de
 * registro dos módulos, e o sintoma seria uma rota "que existe mas devolve 404".
 *
 * Todas públicas: a credencial é `chave` + `hwid` no corpo, não a sessão do
 * painel. E precisam funcionar com a licença VENCIDA — é o caso principal.
 * ============================================================================
 */
import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { RenovacaoService } from './renovacao.service'
import { Public } from '../../core/decorators/public.decorator'

@Public()
@Controller('licenca/renovacao')
export class RenovacaoController {
  constructor(private readonly renovacaoService: RenovacaoService) {}

  /** Períodos, preços e meios de pagamento do plano DESTA licença. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('planos')
  planos(@Body() body: unknown) {
    return this.renovacaoService.planos(body)
  }

  /**
   * Cria a cobrança — PIX (devolve copia-e-cola) ou cartão (devolve URL).
   *
   * Limite apertado: cada chamada nova pode virar uma cobrança no gateway, e
   * gateway tem rate limit próprio. A trava de idempotência já devolve a mesma
   * cobrança para cliques repetidos, então 10/min sobra para uso legítimo e
   * corta quem estivesse martelando.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('cobranca')
  criarCobranca(@Body() body: unknown) {
    return this.renovacaoService.criarCobranca(body)
  }

  /**
   * Cartão, como rota própria — é o que o contrato do ERP descreve.
   *
   * Faz o mesmo que `cobranca` com `metodo: "CARTAO"`; existe separada porque o
   * app trata os dois casos como telas diferentes (QR na tela × abrir navegador)
   * e obrigar a ler `metodo` da resposta para saber qual desenhar seria pior.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('checkout')
  checkout(@Body() body: unknown) {
    return this.renovacaoService.criarCobranca({ ...(body as object), metodo: 'CARTAO' })
  }

  /**
   * Status da cobrança — é o polling do ERP, a cada ~5s enquanto a tela do PIX
   * estiver aberta. Limite generoso por isso: 5s durante 10 min dá ~120 hits.
   */
  @Throttle({ default: { limit: 200, ttl: 60_000 } })
  @Get('cobranca/:id')
  consultar(
    @Param('id')    id: string,
    @Query('chave') chave: string,
    @Query('hwid')  hwid?: string,
  ) {
    return this.renovacaoService.consultarCobranca(id, { chave, hwid })
  }
}
