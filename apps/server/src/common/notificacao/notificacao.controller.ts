/**
 * ============================================================================
 * NOME DO ARQUIVO: notificacao.controller.ts
 * MÓDULO: COMMON/NOTIFICAÇÃO
 * ============================================================================
 * Rotas para o painel gerenciar os aparelhos que recebem notificação.
 *
 * Tudo restrito a ADMIN. Um endpoint de inscrição aberto deixaria qualquer um
 * pendurar o próprio celular na conta e passar a receber, em tempo real, quanto
 * dinheiro entra na plataforma.
 * ============================================================================
 */
import { Controller, Get, Post, Body, Headers, Req } from '@nestjs/common'
import { Request } from 'express'
import { NotificacaoService } from './notificacao.service'
import { Roles } from '../../core/decorators/roles.decorator'

@Roles('ADMIN')
@Controller('notificacao')
export class NotificacaoController {
  constructor(private readonly notificacaoService: NotificacaoService) {}

  /**
   * Estado do recurso e a chave pública para o navegador se inscrever.
   *
   * `disponivel: false` significa que o servidor não tem as chaves VAPID — o
   * painel usa isso para esconder o botão em vez de oferecer algo que vai
   * falhar quando o usuário clicar.
   */
  @Get('config')
  config() {
    return {
      data: {
        disponivel:   this.notificacaoService.disponivel(),
        chavePublica: this.notificacaoService.chavePublica(),
      },
    }
  }

  @Get('aparelhos')
  async aparelhos() {
    return { data: await this.notificacaoService.listar() }
  }

  @Post('inscrever')
  async inscrever(
    @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } },
    // `user` é o payload do JWT, colocado pelo AuthGuard — o id do admin vem em
    // `userId`, não em `id`. Ler o campo errado gravaria a inscrição sem dono e
    // ninguém saberia de quem é o aparelho na hora de revogar.
    @Req() req: Request & { user?: { userId?: string } },
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.notificacaoService.inscrever({
      endpoint:  body.endpoint,
      p256dh:    body.keys.p256dh,
      auth:      body.keys.auth,
      usuarioId: req.user?.userId ?? null,
      userAgent,
    })
  }

  @Post('desinscrever')
  async desinscrever(@Body() body: { endpoint: string }) {
    return this.notificacaoService.desinscrever(body.endpoint)
  }

  /**
   * Notificação de teste. Existe porque push falha em silêncio de um jeito
   * cruel: permissão negada, aparelho não instalado na tela inicial, chave
   * errada — todos dão o mesmo "nada acontece". Um botão de teste transforma
   * isso em resposta imediata.
   */
  @Post('teste')
  async teste() {
    const r = await this.notificacaoService.enviar({
      titulo: 'Teste de notificação',
      corpo:  'Se você está lendo isso, está funcionando.',
      url:    '/financeiro',
    })
    return {
      msg: r.enviados > 0
        ? `Enviada para ${r.enviados} aparelho(s).`
        : 'Nenhum aparelho inscrito recebeu — verifique se as notificações estão ativadas neste dispositivo.',
      data: r,
    }
  }
}
