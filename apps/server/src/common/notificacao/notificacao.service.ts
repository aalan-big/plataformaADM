/**
 * ============================================================================
 * NOME DO ARQUIVO: notificacao.service.ts
 * MÓDULO: COMMON/NOTIFICAÇÃO
 * ============================================================================
 * Notificação push para o celular do admin — Web Push, sem app de loja.
 *
 * A mensagem viaja cifrada de ponta a ponta até o aparelho: a Apple e o Google
 * transportam, mas não conseguem ler o conteúdo. Por isso as chaves VAPID são
 * um par, e a privada nunca sai do servidor.
 *
 * Como o Asaas, NADA aqui é obrigatório para o boot. Sem as chaves VAPID,
 * `disponivel()` devolve false e o painel esconde a opção — a API sobe igual.
 * Notificação é conveniência; derrubar a plataforma por causa dela seria trocar
 * um problema pequeno por um enorme.
 * ============================================================================
 */
import { Injectable, Logger } from '@nestjs/common'
import webpush from 'web-push'
import {
  salvarInscricaoPush,
  removerInscricaoPush,
  findInscricoesPush,
  registrarEnvioPush,
  registrarFalhaPush,
} from '@startbig/database'

/**
 * Falhas seguidas antes de desistir de um aparelho.
 *
 * O serviço de push responde 404/410 quando a inscrição morreu de vez (app
 * desinstalado, permissão revogada) e nesse caso a linha some na hora. Este
 * contador é para a falha INTERMITENTE — rede do fabricante fora do ar — que
 * não deve apagar nada, mas também não pode ser retentada eternamente.
 */
const MAX_FALHAS_SEGUIDAS = 10

export type PayloadNotificacao = {
  titulo:  string
  corpo:   string
  /** Caminho aberto ao tocar na notificação. */
  url?:    string
  /** Agrupa notificações do mesmo assunto no lugar de empilhar. */
  tag?:    string
}

@Injectable()
export class NotificacaoService {
  private readonly logger = new Logger(NotificacaoService.name)
  private configurado = false

  private get chavePublicaVapid(): string {
    return process.env.VAPID_PUBLIC_KEY?.trim() ?? ''
  }

  private get chavePrivadaVapid(): string {
    return process.env.VAPID_PRIVATE_KEY?.trim() ?? ''
  }

  disponivel(): boolean {
    return this.chavePublicaVapid.length > 0 && this.chavePrivadaVapid.length > 0
  }

  /** O navegador precisa da chave pública para se inscrever. Ela é pública mesmo. */
  chavePublica(): string {
    return this.chavePublicaVapid
  }

  /**
   * Configura o web-push sob demanda, e não no construtor.
   *
   * No boot as variáveis podem não estar carregadas ainda, e uma exceção ali
   * derrubaria a API inteira. Aqui, o pior caso é a notificação não sair.
   */
  private configurar(): boolean {
    if (this.configurado) return true
    if (!this.disponivel()) return false

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT?.trim() || 'mailto:suporte@startbig.com.br',
      this.chavePublicaVapid,
      this.chavePrivadaVapid,
    )
    this.configurado = true
    return true
  }

  // ── Inscrição ─────────────────────────────────────────────────────────────

  async inscrever(dados: {
    endpoint:   string
    p256dh:     string
    auth:       string
    usuarioId?: string | null
    userAgent?: string | null
  }) {
    await salvarInscricaoPush({
      endpoint:  dados.endpoint,
      p256dh:    dados.p256dh,
      auth:      dados.auth,
      usuarioId: dados.usuarioId,
      descricao: this.descreverAparelho(dados.userAgent),
    })
    this.logger.log(`[push] aparelho inscrito (${this.descreverAparelho(dados.userAgent)})`)
    return { msg: 'Notificações ativadas neste aparelho.' }
  }

  async desinscrever(endpoint: string) {
    await removerInscricaoPush(endpoint)
    return { msg: 'Notificações desativadas neste aparelho.' }
  }

  async listar() {
    const inscricoes = await findInscricoesPush()
    return inscricoes.map(i => ({
      id:            i.id,
      descricao:     i.descricao ?? 'Aparelho',
      criadoEm:      i.criadoEm,
      ultimoEnvioEm: i.ultimoEnvioEm,
    }))
  }

  /**
   * Nome legível a partir do User-Agent, só para a tela de gerenciamento.
   *
   * Grosseiro de propósito: a intenção é o dono reconhecer qual aparelho
   * revogar, não fazer análise de navegador. Guardar o UA cru seria dado
   * pessoal a mais sem ganho nenhum.
   */
  private descreverAparelho(ua?: string | null): string {
    if (!ua) return 'Aparelho'
    if (/iPhone/i.test(ua))  return 'iPhone'
    if (/iPad/i.test(ua))    return 'iPad'
    if (/Android/i.test(ua)) return 'Android'
    if (/Macintosh/i.test(ua)) return 'Mac'
    if (/Windows/i.test(ua)) return 'Windows'
    return 'Aparelho'
  }

  // ── Envio ─────────────────────────────────────────────────────────────────

  /**
   * Dispara para todos os aparelhos inscritos.
   *
   * NUNCA propaga erro: é chamado de dentro do fluxo de pagamento, e uma falha
   * de notificação não pode desfazer uma renovação que já aconteceu. O cliente
   * pagou e foi liberado; o aviso não ter chegado é chato, não é motivo para
   * derrubar a transação.
   */
  async enviar(payload: PayloadNotificacao): Promise<{ enviados: number; falhas: number }> {
    if (!this.configurar()) return { enviados: 0, falhas: 0 }

    const inscricoes = await findInscricoesPush()
    if (inscricoes.length === 0) return { enviados: 0, falhas: 0 }

    const corpo = JSON.stringify({
      titulo: payload.titulo,
      corpo:  payload.corpo,
      url:    payload.url ?? '/financeiro',
      tag:    payload.tag,
    })

    let enviados = 0
    let falhas   = 0

    await Promise.all(inscricoes.map(async inscricao => {
      try {
        await webpush.sendNotification(
          {
            endpoint: inscricao.endpoint,
            keys:     { p256dh: inscricao.p256dh, auth: inscricao.auth },
          },
          corpo,
        )
        await registrarEnvioPush(inscricao.id)
        enviados++
      } catch (err) {
        falhas++
        const status = (err as { statusCode?: number })?.statusCode

        // 404/410 = a inscrição morreu do outro lado (app desinstalado,
        // permissão revogada). Apagar na hora, senão a lista vira cemitério e
        // toda notificação futura gasta uma tentativa com um endereço morto.
        if (status === 404 || status === 410) {
          await removerInscricaoPush(inscricao.endpoint).catch(() => {})
          this.logger.log(`[push] inscrição expirada removida (${inscricao.descricao ?? 'aparelho'})`)
          return
        }

        await registrarFalhaPush(inscricao.id).catch(() => {})
        if (inscricao.falhasSeguidas + 1 >= MAX_FALHAS_SEGUIDAS) {
          await removerInscricaoPush(inscricao.endpoint).catch(() => {})
          this.logger.warn(`[push] aparelho removido após ${MAX_FALHAS_SEGUIDAS} falhas seguidas`)
          return
        }

        this.logger.warn(`[push] falha ao notificar (${status ?? 'sem status'}): ${err instanceof Error ? err.message : err}`)
      }
    }))

    return { enviados, falhas }
  }

  /**
   * Aviso de pagamento recebido.
   *
   * Sem nome de cliente e sem identificar a licença, de propósito: isto aparece
   * na tela de bloqueio, onde qualquer um ao lado consegue ler. Valor e método
   * bastam para saber que entrou dinheiro; quem pagou se descobre abrindo o
   * painel, que é onde a informação está protegida por login.
   */
  async notificarPagamento(dados: { valor: number; metodo: string }) {
    const valorFormatado = dados.valor.toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
    })

    return this.enviar({
      titulo: 'Pagamento recebido',
      corpo:  `${valorFormatado} · ${dados.metodo}`,
      url:    '/financeiro',
      // Sem tag fixa: cada pagamento é um evento próprio e deve aparecer
      // sozinho. Agrupar faria dois pagamentos seguidos virarem um aviso só.
    })
  }
}
