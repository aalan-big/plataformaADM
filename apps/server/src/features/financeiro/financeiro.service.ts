/**
 * ============================================================================
 * NOME DO ARQUIVO: financeiro.service.ts
 * MÓDULO: FINANCEIRO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de FINANCEIRO. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { Injectable, BadRequestException, NotFoundException, UnauthorizedException, Logger } from '@nestjs/common'
import { ZodError } from 'zod'
import { randomUUID, createHash, timingSafeEqual } from 'crypto'
import {
  findLicencaById,
  findLicencaByStripeSubscriptionId,
  findPlanoById,
  renovarLicencaComHistorico,
  criarPagamento,
  findPagamentosByClienteId,
  findPagamentosByLicencaId,
  findPagamentoByTransacaoId,
  findAllPagamentos,
  sumReceitaMes,
  criarTransacao,
  findTransacoesByClienteId,
  findTransacoesByLicencaId,
  findLicencasExpirandoOuVencidas,
  updateLicenca,
  registrarEventoLicenca,
  findCobrancaByGatewayId,
  marcarCobrancaPaga,
  marcarCobrancaStatus,
  findCobrancasRenovacao,
  contarCobrancasPorStatus,
  estenderModulosExtras,
} from '@startbig/database'
import { confirmarPagamentoSchema, gerarCobrancaSchema } from '@startbig/schemas'
import { EmailService } from '../../core/email/email.service'
import { StripeService } from '../../common/stripe/stripe.service'
import { ParceiroService } from '../parceiro/parceiro.service'
import { NotificacaoService } from '../../common/notificacao/notificacao.service'
import { montarOpcoes } from '../plano/plano.precos'

/**
 * Dias que a licenca continua valendo depois do vencimento quando o CARTAO
 * falhou. Cobre a janela de retentativas do Stripe (dunning) sem virar mes
 * gratis. Vale so para cartao — ver o comentario em invoice.payment_failed.
 */
const CARENCIA_CARTAO_DIAS = 7

/**
 * Como cada gateway aparece na notificação do celular.
 *
 * O nome interno (STRIPE, ASAAS) não diz nada para quem lê a tela de bloqueio;
 * o que a pessoa reconhece é o MEIO de pagamento, não o fornecedor.
 */
const NOME_DO_GATEWAY: Record<string, string> = {
  STRIPE: 'Cartão',
  ASAAS:  'PIX',
  MANUAL: 'Manual',
}

@Injectable()
export class FinanceiroService {
  private readonly logger = new Logger(FinanceiroService.name)

  constructor(
    private readonly stripeService:   StripeService,
    private readonly emailService:    EmailService,
    private readonly parceiroService: ParceiroService,
    private readonly notificacao:     NotificacaoService,
  ) {}

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async resumo() {
    const agora    = new Date()
    const anoAtual = agora.getFullYear()
    const mesAtual = agora.getMonth() + 1
    const mesAnterior = mesAtual === 1 ? 12 : mesAtual - 1
    const anoAnterior = mesAtual === 1 ? anoAtual - 1 : anoAtual

    const [atual, anterior] = await Promise.all([
      sumReceitaMes(anoAtual,    mesAtual),
      sumReceitaMes(anoAnterior, mesAnterior),
    ])

    const crescimento = anterior.total > 0
      ? ((atual.total - anterior.total) / anterior.total) * 100
      : null

    return {
      mesAtual:    { total: atual.total,    quantidade: atual.quantidade    },
      mesAnterior: { total: anterior.total, quantidade: anterior.quantidade },
      crescimento: crescimento !== null ? parseFloat(crescimento.toFixed(1)) : null,
    }
  }

  async pagamentos(filtro: { ano?: string; mes?: string; gateway?: string; q?: string }) {
    return findAllPagamentos({
      ano:     filtro.ano     ? Number(filtro.ano)  : undefined,
      mes:     filtro.mes     ? Number(filtro.mes)  : undefined,
      gateway: filtro.gateway || undefined,
      q:       filtro.q       || undefined,
    })
  }

  async inadimplentes(dias = 30) {
    return findLicencasExpirandoOuVencidas(dias)
  }

  /**
   * Cobranças de renovação para o painel — inclusive as que NÃO viraram dinheiro.
   *
   * A lista de pagamentos só mostra o que entrou. Um PIX gerado e abandonado não
   * aparece em lugar nenhum lá, e é justamente o dado que revela cliente tentando
   * renovar e desistindo — ou, pior, tentando e falhando por um defeito nosso.
   */
  async cobrancas(filtro: { status?: string; limite?: string }) {
    const [lista, resumo] = await Promise.all([
      findCobrancasRenovacao({
        status: filtro.status || undefined,
        limite: filtro.limite ? Number(filtro.limite) : undefined,
      }),
      contarCobrancasPorStatus(),
    ])
    return { lista, resumo }
  }

  async receitaMes(ano: number, mes: number) {
    return sumReceitaMes(ano, mes)
  }

  // ── Histórico ──────────────────────────────────────────────────────────────

  async historicoCliente(clienteId: string)   { return findPagamentosByClienteId(clienteId) }
  async historicoLicenca(licencaId: string)   { return findPagamentosByLicencaId(licencaId) }
  async transacoesCliente(clienteId: string)  { return findTransacoesByClienteId(clienteId) }
  async transacoesLicenca(licencaId: string)  { return findTransacoesByLicencaId(licencaId) }

  // ── Plano de pagamento (público) ───────────────────────────────────────────

  async planoPagamento(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    const plano = licenca.plano
    if (!plano) throw new NotFoundException('Plano não encontrado.')

    const nome = !!licenca.cliente.pf
      ? (licenca.cliente.pf?.nomeCompleto ?? licenca.cliente.email)
      : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

    return {
      licencaId,
      cliente:        { nome, email: licenca.cliente.email },
      plano:          plano.nome,
      status:         licenca.status,
      dataVencimento: licenca.dataVencimento,
      // Mesmo cálculo usado pela contratação pública — ver plano.precos.ts.
      opcoes: montarOpcoes(plano),
    }
  }

  // ── Stripe Checkout (assinatura recorrente) ────────────────────────────────

  /**
   * Domínios para os quais o checkout pode voltar. O cliente que comprou em
   * `assine.` precisa voltar para `assine.` — mas a origem chega do navegador,
   * então nunca é usada crua: valor fora da lista cai no APP_URL. Sem isso,
   * qualquer um mandaria o cliente para um domínio próprio depois do pagamento.
   */
  private validarOrigem(origem?: string): string | undefined {
    if (!origem) return undefined

    const padrao    = process.env.APP_URL ?? ''
    const adicionais = (process.env.APP_URLS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const permitidas = [padrao, ...adicionais].filter(Boolean).map(u => u.replace(/\/$/, ''))

    const limpa = origem.replace(/\/$/, '')
    if (permitidas.includes(limpa)) return limpa

    console.warn(`[checkout] origem "${origem}" fora da allowlist — usando APP_URL`)
    return undefined
  }

  async gerarCobranca(body: unknown, origem?: string) {
    let dados: ReturnType<typeof gerarCobrancaSchema.parse>
    try {
      dados = gerarCobrancaSchema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }

    const licenca = await findLicencaById(dados.licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    if (!licenca.plano) throw new NotFoundException('Plano não encontrado.')

    // Anti-duplicidade: se a licença já tem assinatura ATIVA no Stripe, gerar uma
    // nova cobrança criaria uma 2ª assinatura e cobraria o cliente duas vezes.
    // Nesse caso o caminho certo é "Trocar plano" (ajuste proporcional), não uma
    // cobrança nova. Só liberamos cobrança nova quando não há assinatura viva.
    if (licenca.stripeSubscriptionId && await this.stripeService.assinaturaAtiva(licenca.stripeSubscriptionId)) {
      throw new BadRequestException(
        'Esta licença já possui uma assinatura ativa. Para mudar de plano ou período, use "Trocar plano" (cobra apenas a diferença proporcional). Para gerar uma cobrança nova, cancele a assinatura atual antes.',
      )
    }

    // Cobrança de OUTRO plano (troca paga): o preço vem do plano de destino, e a
    // licença só é movida quando o pagamento confirmar — nunca antes.
    let plano = licenca.plano as any
    if (dados.planoId && dados.planoId !== licenca.planoId) {
      const destino = await findPlanoById(dados.planoId)
      if (!destino)                     throw new NotFoundException('Plano de destino não encontrado.')
      if (destino.status !== 'ATIVO')   throw new BadRequestException('O plano de destino está inativo.')
      plano = destino
    }

    // Assinatura recorrente: cada período usa um Price pré-criado no catálogo do Stripe.
    let stripePriceId: string | null
    if (dados.meses === 1)       stripePriceId = plano.stripePriceIdMensal
    else if (dados.meses === 3)  stripePriceId = plano.stripePriceIdTrimestral
    else if (dados.meses === 12) stripePriceId = plano.stripePriceIdAnual
    else throw new BadRequestException('Período inválido — use 1 (mensal), 3 (trimestral) ou 12 (anual).')

    if (!stripePriceId)
      throw new BadRequestException(`O plano "${plano.nome}" não tem Stripe Price ID configurado para ${dados.meses} mês(es). Cadastre o price_... no plano.`)

    // O Stripe recusa o checkout se o Price não existir no modo da chave em uso
    // (o caso clássico: Price de teste com chave live). Sem este try, o cliente
    // recebia a mensagem crua do gateway e nós não ficávamos sabendo de nada.
    try {
      const result = await this.stripeService.criarCheckoutSession({
        meses:         dados.meses,
        licencaId:     dados.licencaId,
        email:         licenca.cliente.email,
        stripePriceId,
        appUrl:        this.validarOrigem(origem),
        ...(plano.id !== licenca.planoId ? { planoId: plano.id } : {}),
      })

      return { url: result.url, sessionId: result.sessionId }
    } catch (err) {
      await this.alarmarFalhaCheckout({
        motivo:     `Plano "${plano.nome}", ${dados.meses} mês(es), price ${stripePriceId}: ${err instanceof Error ? err.message : err}`,
        referencia: dados.licencaId,
      })
      throw new BadRequestException(
        'Não foi possível iniciar o pagamento agora. Nossa equipe já foi avisada — tente novamente em alguns minutos ou fale com o suporte.',
      )
    }
  }

  // ── Confirmação manual (admin) ─────────────────────────────────────────────

  async confirmarPagamentoManual(body: unknown) {
    let dados: ReturnType<typeof confirmarPagamentoSchema.parse>
    try {
      dados = confirmarPagamentoSchema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }

    const licenca = await findLicencaById(dados.licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const nomeCliente = !!licenca.cliente.pf
      ? (licenca.cliente.pf?.nomeCompleto ?? licenca.cliente.email)
      : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

    const base = licenca.dataVencimento && licenca.dataVencimento > new Date()
      ? new Date(licenca.dataVencimento) : new Date()

    const dataVencimento = new Date(base)
    dataVencimento.setMonth(dataVencimento.getMonth() + dados.meses)

    const chaveAtivacao = `START-${randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`

    await renovarLicencaComHistorico(dados.licencaId, { chaveAtivacao, dataVencimento, meses: dados.meses, ultimoPagamento: new Date() })

    const pagamento = await criarPagamento({ licencaId: dados.licencaId, clienteId: licenca.clienteId, valor: dados.valor, meses: dados.meses, gateway: 'MANUAL', observacao: dados.observacao })
    await criarTransacao({ clienteId: licenca.clienteId, licencaId: dados.licencaId, pagamentoId: pagamento.id, tipo: 'PAGAMENTO_RECEBIDO', valor: dados.valor, origem: 'MANUAL', descricao: dados.observacao ?? `Pagamento manual — ${dados.meses} mês(es)` })

    // Pagamento manual também gera repasse: o dinheiro entrou igual, e o cliente
    // continua sendo do parceiro independentemente da forma de pagamento.
    await this.parceiroService.apurarComissao({
      id: pagamento.id, clienteId: licenca.clienteId, licencaId: dados.licencaId,
      valor: dados.valor, meses: dados.meses,
    })

    // Pagamento manual também notifica: para quem olha o celular, dinheiro que
    // entrou é dinheiro que entrou — a origem não muda o fato. Sem isto ele
    // seria o único caminho de pagamento silencioso, e a ausência de aviso
    // pareceria falha do sistema em vez de decisão.
    await this.notificacao.notificarPagamento({ valor: dados.valor, metodo: NOME_DO_GATEWAY.MANUAL })

    let emailEnviado = false
    try {
      await this.emailService.enviarChaveAtivacao({ email: licenca.cliente.email, nomeCliente, chave: chaveAtivacao, dataVencimento, nomeDispositivo: licenca.nomeDispositivo ?? 'Dispositivo' })
      emailEnviado = true
    } catch (err) {
      console.warn('[email] falha ao enviar chave:', err instanceof Error ? err.message : err)
    }

    return {
      msg:  emailEnviado ? 'Pagamento confirmado e chave enviada por e-mail' : 'Pagamento confirmado — e-mail não enviado (SMTP não configurado)',
      data: { chaveAtivacao, dataVencimento, emailEnviado: emailEnviado ? licenca.cliente.email : null },
    }
  }

  // ── Webhook Stripe ─────────────────────────────────────────────────────────

  async webhookStripe(rawBody: Buffer, signature: string) {
    let evento: ReturnType<typeof this.stripeService.parsearEvento>
    try {
      evento = this.stripeService.parsearEvento(rawBody, signature)
    } catch (err) {
      throw new BadRequestException(`Webhook inválido: ${err instanceof Error ? err.message : err}`)
    }

    // ── 1. Primeiro pagamento da assinatura ──────────────────────────────────
    if (evento.tipo === 'checkout.session.completed') {
      const { sessionId, subscriptionId, licencaId, planoId, meses, amountTotal, email } = (evento as any).dados

      const jaProcessado = await findPagamentoByTransacaoId(sessionId)
      if (jaProcessado) return { msg: 'Pagamento já processado' }

      if (!licencaId) {
        await this.alarmarDescarte({
          evento:     'checkout.session.completed',
          motivo:     'Sessão sem metadata.licencaId — pagamento nascido fora do fluxo da plataforma (ex.: Payment Link avulso)',
          referencia: sessionId,
          valor:      (amountTotal ?? 0) / 100,
        })
        return { msg: 'licencaId ausente nos metadados — ignorado' }
      }

      let licenca = await findLicencaById(licencaId)
      if (!licenca) {
        await this.alarmarDescarte({
          evento:     'checkout.session.completed',
          motivo:     `Licença ${licencaId} não existe mais no banco (apagada depois do checkout?)`,
          referencia: sessionId,
          valor:      (amountTotal ?? 0) / 100,
        })
        throw new NotFoundException('Licença não encontrada.')
      }

      // Troca de plano paga: o checkout foi gerado para outro plano, e é AQUI —
      // com o pagamento confirmado — que a licença muda. Antes disso ela não
      // muda em lugar nenhum, então cliente que não paga não sobe de plano.
      if (planoId && planoId !== licenca.planoId) {
        const destino = await findPlanoById(planoId)
        if (destino) {
          await updateLicenca(licencaId, { planoId, planoPendenteId: null })
          await registrarEventoLicenca(licencaId, {
            tipo: 'TROCA_PLANO',
            chaveAtivacao: licenca.chaveAtivacao,
            observacao: `Plano alterado para "${destino.nome}" após confirmação do pagamento.`,
          })
          licenca = { ...licenca, planoId, plano: destino } as typeof licenca
        } else {
          console.warn(`[webhook] planoId ${planoId} da metadata não existe — licença mantida no plano atual`)
        }
      }

      const resultado = await this.processarRenovacao({
        licenca, meses, valor: (amountTotal ?? 0) / 100, transacaoId: sessionId, gateway: 'STRIPE', origem: 'STRIPE',
        descricao: `Stripe checkout — ${meses} mês(es)`,
      })

      // Anti-cobrança-duplicada: se a licença já tinha uma assinatura ativa (troca de plano
      // ou cliente clicou em pagar de novo), cancela a antiga antes de trocar o vínculo —
      // senão o Stripe continuaria cobrando as duas e as faturas da antiga virariam "fantasma".
      const subAntiga = (licenca as any).stripeSubscriptionId as string | null
      if (subscriptionId && subAntiga && subAntiga !== subscriptionId) {
        try {
          await this.stripeService.cancelarSubscription(subAntiga)
        } catch (err) {
          console.warn(`[stripe] falha ao cancelar assinatura antiga ${subAntiga}:`, err instanceof Error ? err.message : err)
        }
      }

      // Salva o ID da assinatura para mapear renovações futuras
      if (subscriptionId) {
        await updateLicenca(licencaId, { stripeSubscriptionId: subscriptionId })
      }

      return { msg: 'Pagamento inicial processado', data: resultado }
    }

    // ── 2. Fatura paga: renovação de ciclo OU ajuste proporcional de plano (upgrade)
    if (evento.tipo === 'invoice.payment_succeeded') {
      const { invoiceId, subscriptionId, amountTotal, billingReason, licencaId: metaLicencaId, meses: metaMeses } = (evento as any).dados
      if (!subscriptionId) {
        await this.alarmarDescarte({
          evento:     'invoice.payment_succeeded',
          motivo:     'Fatura paga sem assinatura vinculada — impossível saber de quem é',
          referencia: invoiceId,
          valor:      amountTotal,
        })
        return { msg: 'subscriptionId ausente — ignorado' }
      }

      // Idempotência: o id da fatura é estável e único. Se o Stripe reenviar o mesmo
      // webhook (entrega "pelo menos uma vez"), não reprocessa — evita renovar/cobrar em dobro.
      const jaProcessado = await findPagamentoByTransacaoId(invoiceId)
      if (jaProcessado) return { msg: 'Fatura já processada' }

      let licenca = await findLicencaByStripeSubscriptionId(subscriptionId)
      if (!licenca && metaLicencaId) licenca = await findLicencaById(metaLicencaId)
      if (!licenca) {
        await this.alarmarDescarte({
          evento:     'invoice.payment_succeeded',
          motivo:     `Nenhuma licença com stripeSubscriptionId ${subscriptionId} — o cliente pagou e a renovação NÃO foi aplicada`,
          referencia: invoiceId,
          valor:      amountTotal,
        })
        return { msg: `Licença com subscription ${subscriptionId} não encontrada — ignorado` }
      }

      // Upgrade: o Stripe cobra a diferença proporcional numa fatura "subscription_update".
      // Registra o valor no financeiro SEM mexer no vencimento (não é renovação).
      if (billingReason === 'subscription_update') {
        if (amountTotal <= 0) return { msg: 'Ajuste de plano sem cobrança — ignorado' }
        const pagamento = await criarPagamento({ licencaId: licenca.id, clienteId: licenca.clienteId, valor: amountTotal, meses: 0, gateway: 'STRIPE', transacaoId: invoiceId, observacao: 'Ajuste proporcional de plano (upgrade)' })
        await criarTransacao({ clienteId: licenca.clienteId, licencaId: licenca.id, pagamentoId: pagamento.id, tipo: 'PAGAMENTO_RECEBIDO', valor: amountTotal, origem: 'STRIPE', descricao: 'Ajuste proporcional de plano (upgrade)' })

        // meses = 0 aqui: na comissão fixa por mês isso dá R$ 0 e nenhuma linha é
        // criada. Já na comissão percentual, o parceiro recebe sobre a diferença
        // cobrada no upgrade — que é receita real. Quem decide é a regra dele.
        await this.parceiroService.apurarComissao({
          id: pagamento.id, clienteId: licenca.clienteId, licencaId: licenca.id,
          valor: amountTotal, meses: 0,
        })
        return { msg: 'Ajuste proporcional de plano registrado' }
      }

      // Só a fatura de ciclo renova a licença (a do 1º pagamento é tratada no checkout)
      if (billingReason !== 'subscription_cycle') {
        // 'subscription_create' é o 1º pagamento e já foi processado no checkout — descarte esperado.
        // Qualquer outro motivo com valor cobrado é dinheiro entrando sem contrapartida: alarma.
        if (billingReason !== 'subscription_create' && amountTotal > 0) {
          await this.alarmarDescarte({
            evento:     'invoice.payment_succeeded',
            motivo:     `billing_reason inesperado "${billingReason}" — cobrado do cliente, mas nenhuma regra tratou`,
            referencia: invoiceId,
            valor:      amountTotal,
          })
        }
        return { msg: `billing_reason "${billingReason}" ignorado` }
      }

      // meses vem da metadata da fatura; só chama a API se por algum motivo não veio
      const meses = metaMeses ?? (await this.stripeService.buscarMetadadosSubscription(subscriptionId)).meses

      const resultado = await this.processarRenovacao({
        licenca, meses, valor: amountTotal, transacaoId: invoiceId,
        gateway: 'STRIPE', origem: 'STRIPE', descricao: `Renovação automática Stripe — ${meses} mês(es)`,
      })

      // Downgrade agendado: se havia plano pendente, o novo ciclo é o momento de aplicá-lo
      const planoPendenteId = (licenca as any).planoPendenteId as string | null
      if (planoPendenteId) {
        await updateLicenca(licenca.id, { planoId: planoPendenteId, planoPendenteId: null })
        await registrarEventoLicenca(licenca.id, { tipo: 'TROCA_PLANO', chaveAtivacao: licenca.chaveAtivacao, observacao: 'Downgrade agendado aplicado no início do novo ciclo.' })
      }

      return { msg: 'Renovação automática processada', data: resultado }
    }

    // ── 2b. Falha de pagamento na renovação (cartão recusado/vencido) ────────
    if (evento.tipo === 'invoice.payment_failed') {
      const { subscriptionId, licencaId: metaLicencaId } = (evento as any).dados
      let licenca = subscriptionId ? await findLicencaByStripeSubscriptionId(subscriptionId) : null
      if (!licenca && metaLicencaId) licenca = await findLicencaById(metaLicencaId)
      if (!licenca) {
        await this.alarmarDescarte({
          evento:     'invoice.payment_failed',
          motivo:     `Cobrança recusada numa assinatura sem licença correspondente (${subscriptionId}) — cliente não foi avisado`,
          referencia: subscriptionId ?? '(sem subscription)',
          valor:      null,
        })
        return { msg: 'Licença não encontrada para fatura falha — ignorado' }
      }

      const nomeCliente = !!licenca.cliente.pf
        ? (licenca.cliente.pf?.nomeCompleto ?? licenca.cliente.email)
        : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

      // Abre a carência: a licença continua valendo enquanto o Stripe re-tenta.
      //
      // Só o CARTÃO ganha isso, e o motivo é o meio de pagamento, não o cliente:
      // quem paga no cartão pode ficar inadimplente sem querer (cartão vencido,
      // limite, banco recusando) e sem nem saber. Quem paga por PIX escolhe pagar
      // — não existe PIX que falha sozinho — então trava no vencimento.
      //
      // Gravada UMA vez: cada retentativa do Stripe dispara este evento de novo,
      // e reescrever a data a cada uma empurraria o prazo para frente sem fim,
      // transformando sete dias de tolerância em acesso grátis permanente.
      if (!licenca.carenciaAte) {
        const ate = new Date()
        ate.setDate(ate.getDate() + CARENCIA_CARTAO_DIAS)
        await updateLicenca(licenca.id, { carenciaAte: ate })
        await registrarEventoLicenca(licenca.id, {
          tipo:          'CARENCIA_ABERTA',
          chaveAtivacao: licenca.chaveAtivacao,
          observacao:    `Cartão recusado — acesso mantido até ${ate.toLocaleDateString('pt-BR')} enquanto o Stripe tenta cobrar novamente.`,
        })
      }

      try {
        await this.emailService.enviarFalhaPagamento({ email: licenca.cliente.email, nomeCliente, dataVencimento: licenca.dataVencimento })
      } catch (err) {
        console.warn('[email] falha ao enviar aviso de pagamento recusado:', err instanceof Error ? err.message : err)
      }

      // Não bloqueia: o Stripe re-tenta a cobrança nos próximos dias (dunning). Se todas
      // as tentativas falharem, ele dispara customer.subscription.deleted (tratado abaixo).
      return { msg: 'Falha de pagamento — cliente notificado, carência aberta' }
    }

    // ── 3. Assinatura encerrada (cancelada ou após esgotar as tentativas) ─────
    if (evento.tipo === 'customer.subscription.deleted') {
      const { subscriptionId } = (evento as any).dados
      const licenca = await findLicencaByStripeSubscriptionId(subscriptionId)
      if (!licenca) {
        await this.alarmarDescarte({
          evento:     'customer.subscription.deleted',
          motivo:     'Assinatura encerrada sem licença correspondente — ninguém foi desvinculado no banco',
          referencia: subscriptionId,
          valor:      null,
        })
        return { msg: 'Licença não encontrada para essa assinatura — ignorado' }
      }

      // Para as renovações futuras, mas mantém o acesso até o fim do período já pago
      // (a licença expira naturalmente pela dataVencimento, via cron/validar).
      //
      // A carência morre junto: ela existia para cobrir as retentativas do Stripe,
      // e a assinatura encerrada significa que elas acabaram. Deixá-la de pé daria
      // ao cliente mais dias depois de já não haver ninguém tentando cobrar.
      await updateLicenca(licenca.id, { stripeSubscriptionId: null, carenciaAte: null })
      await registrarEventoLicenca(licenca.id, { tipo: 'ASSINATURA_CANCELADA', chaveAtivacao: licenca.chaveAtivacao, observacao: 'Assinatura Stripe encerrada — sem renovação automática. Acesso mantido até o vencimento.' })
      return { msg: 'Assinatura encerrada — acesso mantido até o vencimento' }
    }

    return { msg: `Evento ${evento.tipo} ignorado` }
  }

  /**
   * Autentica o webhook do Asaas.
   *
   * O Asaas não assina o corpo como o Stripe faz: a autenticação dele é um token
   * fixo, definido por nós ao cadastrar o webhook no painel e devolvido a cada
   * entrega no header `asaas-access-token`. Sem esta conferência a rota é uma
   * porta destrancada — quem descobrir a URL manda um PAYMENT_RECEIVED apontando
   * para a licença que quiser e renova de graça, com o dinheiro nunca existindo.
   *
   * Falha FECHADA de propósito: sem ASAAS_WEBHOOK_TOKEN no ambiente, ninguém
   * entra. O contrário — aceitar tudo enquanto o token não estiver configurado —
   * é exatamente o estado que este método corrige, e é o pior padrão possível,
   * porque funciona em silêncio até o dia em que alguém abusa.
   *
   * Por isso o Asaas também NÃO entra em `validarSegredosProducao`: faltando a
   * variável, só o PIX fica indisponível. Torná-la obrigatória derrubaria o boot
   * da API inteira — e junto com ela o Stripe e a validação de todas as licenças
   * em operação — por causa de um meio de pagamento que ainda nem é o principal.
   */
  private conferirTokenAsaas(tokenRecebido?: string): void {
    const esperado = process.env.ASAAS_WEBHOOK_TOKEN
    if (!esperado) {
      console.error('[asaas] webhook recebido mas ASAAS_WEBHOOK_TOKEN não está configurada — recusado')
      throw new UnauthorizedException('Webhook Asaas não configurado neste ambiente.')
    }
    if (!tokenRecebido) throw new UnauthorizedException('Token do webhook ausente.')

    // Compara os hashes, não os textos: `timingSafeEqual` exige buffers do mesmo
    // tamanho e estouraria com token de comprimento diferente — e esse estouro,
    // por si só, já entregaria o tamanho do segredo a quem estivesse tentando.
    const recebido = createHash('sha256').update(tokenRecebido).digest()
    const correto  = createHash('sha256').update(esperado).digest()
    if (!timingSafeEqual(recebido, correto)) {
      console.error('[asaas] webhook recusado — token inválido')
      throw new UnauthorizedException('Token do webhook inválido.')
    }
  }

  /**
   * Um pagamento Asaas confirmado vira renovação.
   *
   * Ponto único onde "o dinheiro do PIX entrou" tem consequência — chamado pelo
   * webhook (caminho normal) e pela conciliação do polling (webhook perdido).
   * Duas implementações disso seria garantir que um dia uma renovasse e a outra
   * não, dependendo de qual chegasse primeiro.
   *
   * Nada aqui acredita no gateway além de "a cobrança X foi paga": meses e
   * licença saem da nossa CobrancaRenovacao.
   */
  async confirmarCobrancaAsaas(params: {
    gatewayCobrancaId: string
    valorPago:         number
    origem:            string
  }) {
    const cobranca = await findCobrancaByGatewayId(params.gatewayCobrancaId)
    if (!cobranca) {
      await this.alarmarDescarte({
        evento:     `asaas:${params.origem}`,
        motivo:     'Pagamento sem CobrancaRenovacao correspondente — cobrança criada fora do fluxo da plataforma, ou apagada depois',
        referencia: params.gatewayCobrancaId,
        valor:      params.valorPago,
      })
      return { msg: 'Cobrança não encontrada — ignorado' }
    }

    // Idempotência em dois níveis: o status da própria cobrança e o id da
    // transação no financeiro. O Asaas entrega "pelo menos uma vez", e a
    // conciliação pode correr junto com o webhook — sem isto, a mesma entrega
    // repetida renovaria de novo e lançaria receita duas vezes.
    if (cobranca.status === 'PAGA') return { msg: 'Cobrança já processada' }
    if (await findPagamentoByTransacaoId(params.gatewayCobrancaId))
      return { msg: 'Pagamento já lançado' }

    let licenca = await findLicencaById(cobranca.licencaId)
    if (!licenca) {
      await this.alarmarDescarte({
        evento:     `asaas:${params.origem}`,
        motivo:     `Licença ${cobranca.licencaId} da cobrança não existe mais no banco`,
        referencia: params.gatewayCobrancaId,
        valor:      params.valorPago,
      })
      return { msg: 'Licença não encontrada — ignorado' }
    }

    // Pagou MENOS do que foi cobrado: não renova sozinho. Pagar a mais é
    // normal (juros/multa de atraso do próprio gateway) e passa direto; pagar
    // a menos é anomalia, e estender a licença mesmo assim seria dar mês de
    // graça em silêncio. Vira alarme para alguém decidir na mão.
    const esperado = Number(cobranca.valor)
    if (params.valorPago + 0.01 < esperado) {
      await this.alarmarDescarte({
        evento:     `asaas:${params.origem}`,
        motivo:     `Valor pago (R$ ${params.valorPago.toFixed(2)}) menor que o cobrado (R$ ${esperado.toFixed(2)}) — licença NÃO renovada`,
        referencia: params.gatewayCobrancaId,
        valor:      params.valorPago,
      })
      return { msg: 'Valor pago menor que o cobrado — renovação não aplicada' }
    }

    // Troca de plano paga por PIX: a cobrança guarda o plano de DESTINO, e é
    // AQUI — com o dinheiro confirmado — que a licença se move. Antes disso ela
    // não muda em lugar nenhum, então cliente que não paga não sobe de plano.
    // Mesma regra que o checkout do Stripe já seguia.
    if (cobranca.planoId && cobranca.planoId !== licenca.planoId) {
      const destino = await findPlanoById(cobranca.planoId)
      if (destino) {
        await updateLicenca(licenca.id, { planoId: cobranca.planoId, planoPendenteId: null })
        await registrarEventoLicenca(licenca.id, {
          tipo:          'TROCA_PLANO',
          chaveAtivacao: licenca.chaveAtivacao,
          observacao:    `Plano alterado para "${destino.nome}" após confirmação do PIX.`,
        })
        licenca = { ...licenca, planoId: cobranca.planoId, plano: destino } as typeof licenca
      } else {
        // Plano apagado entre a geração da cobrança e o pagamento. Renovar no
        // plano atual é melhor que travar: o cliente pagou, e o dinheiro está
        // registrado — a divergência de plano um humano resolve.
        await this.alarmarDescarte({
          evento:     `asaas:${params.origem}`,
          motivo:     `Plano de destino ${cobranca.planoId} não existe mais — licença renovada NO PLANO ATUAL`,
          referencia: params.gatewayCobrancaId,
          valor:      params.valorPago,
        })
      }
    }

    /**
     * Módulos avulsos renovam junto com a licença.
     *
     * O valor deles já entrou no PIX que acabou de ser pago, então o acesso tem
     * que acompanhar: sem isto o cliente pagaria três meses de módulo numa
     * renovação trimestral e perderia o acesso depois do primeiro.
     */
    try {
      const estendidos = await estenderModulosExtras(licenca.id, cobranca.meses)
      if (estendidos > 0)
        this.logger.log(`[modulo] ${estendidos} módulo(s) avulso(s) da licença ${licenca.id} estendido(s) por ${cobranca.meses} mês(es).`)
    } catch (err) {
      // Best-effort: o dinheiro entrou e a licença renova de qualquer jeito.
      // Falhar aqui não pode desfazer um pagamento confirmado.
      this.logger.error(`[modulo] falha ao estender módulos da licença ${licenca.id}: ${err instanceof Error ? err.message : err}`)
    }

    /**
     * O valor lançado no financeiro é o que ENTROU — o extrato tem que bater.
     *
     * Já a base da COMISSÃO é só a parte do plano. O parceiro indicou o cliente
     * para o plano; o módulo avulso foi venda sua. Sem separar, um parceiro
     * percentual passaria a receber sobre o módulo todo mês, para sempre.
     *
     * A proporção sai da cobrança, não de um recálculo: entre gerar o PIX e
     * pagá-lo o cliente pode ter ganhado ou perdido um módulo, e a comissão tem
     * que sair sobre o que foi cobrado naquele dia.
     */
    const cobrado    = Number(cobranca.valor)
    const doPlano    = cobranca.valorPlano != null ? Number(cobranca.valorPlano) : cobrado
    const proporcao  = cobrado > 0 ? doPlano / cobrado : 1
    const baseComissao = Math.round(params.valorPago * proporcao * 100) / 100

    const resultado = await this.processarRenovacao({
      licenca,
      meses:        cobranca.meses,
      valor:        params.valorPago,
      valorComissionavel: baseComissao,
      transacaoId:  params.gatewayCobrancaId,
      gateway:      'ASAAS',
      origem:       'ASAAS',
      descricao:    `PIX Asaas — ${cobranca.meses} mês(es)`,
    })

    // SÓ AGORA a cobrança vira PAGA (invariante I2 do contrato do ERP). O app
    // trata PAGA como "pode revalidar": na ordem inversa ele revalidaria,
    // receberia a data velha, e quem acabou de pagar veria o sistema travado.
    await marcarCobrancaPaga(cobranca.id, { pagamentoId: resultado.pagamentoId, pagoEm: new Date() })

    return { msg: 'Pagamento Asaas processado', data: resultado }
  }

  /**
   * Webhook do Asaas.
   *
   * Devolve 2xx para TUDO que não seja falha de autenticação — inclusive para
   * evento que ignoramos. O Asaas interrompe a fila após 15 falhas seguidas, e
   * uma fila interrompida significa cliente pagando sem a licença renovar. Erro
   * nosso de processamento vira alarme, nunca status de erro na resposta.
   */
  async webhookAsaas(body: any, tokenRecebido?: string) {
    this.conferirTokenAsaas(tokenRecebido)

    if (!body || typeof body !== 'object' || !body.event)
      throw new BadRequestException('Formato de webhook Asaas inválido.')

    const evento    = String(body.event)
    const pagamento = body.payment ?? {}
    const idGateway = pagamento.id ? String(pagamento.id) : null

    if (!idGateway) {
      // 200 de propósito: repetir uma entrega sem id não vai melhorar nada, e
      // insistir só derrubaria a fila de quem depende dela.
      this.logger.warn(`[asaas] evento ${evento} sem payment.id — ignorado`)
      return { msg: `Evento ${evento} sem identificação de cobrança — ignorado` }
    }

    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
      return this.confirmarCobrancaAsaas({
        gatewayCobrancaId: idGateway,
        valorPago:         Number(pagamento.value ?? 0),
        origem:            'webhook',
      })
    }

    // Cobrança vencida sem pagamento: fecha a linha para o próximo pedido do
    // cliente gerar um PIX novo em vez de reaproveitar um código morto.
    if (evento === 'PAYMENT_OVERDUE') {
      const cobranca = await findCobrancaByGatewayId(idGateway)
      if (cobranca && cobranca.status === 'PENDENTE') {
        await marcarCobrancaStatus(cobranca.id, 'EXPIRADA')
        return { msg: 'Cobrança marcada como expirada' }
      }
      return { msg: 'Cobrança vencida sem correspondência pendente — ignorado' }
    }

    // Dinheiro SAINDO depois de já ter entrado. Não desfazemos a renovação
    // automaticamente: a licença pode estar em uso há semanas e revogar sozinho
    // é pior do que avisar. Mas silêncio aqui seria prejuízo invisível.
    if (evento === 'PAYMENT_REFUNDED' || evento === 'PAYMENT_CHARGEBACK_REQUESTED' || evento === 'PAYMENT_DELETED') {
      const cobranca = await findCobrancaByGatewayId(idGateway)
      await this.alarmarDescarte({
        evento:     `asaas:${evento}`,
        motivo:     cobranca
          ? `Pagamento revertido de uma cobrança ${cobranca.status} — a licença ${cobranca.licencaId} segue renovada e precisa de decisão manual`
          : 'Pagamento revertido sem cobrança correspondente no banco',
        referencia: idGateway,
        valor:      Number(pagamento.value ?? 0) || null,
      })
      return { msg: `Evento ${evento} registrado para conferência manual` }
    }

    return { msg: `Evento Asaas ${evento} ignorado` }
  }

  // ── Helper: alarme de descarte ─────────────────────────────────────────────

  /**
   * Chamado sempre que um evento de DINHEIRO é descartado sem alterar licença nenhuma.
   * O descarte em si continua sendo a resposta certa (não dá pra adivinhar o dono do
   * pagamento) — o que não pode é ser silencioso: sem aviso, quem descobre é o cliente,
   * semanas depois. Nunca propaga erro: alarme quebrado não pode derrubar o webhook.
   */
  private async alarmarDescarte(dados: {
    evento:     string
    motivo:     string
    referencia: string
    valor:      number | null
  }) {
    console.warn(`[alarme] ${dados.evento} descartado — ${dados.motivo} (ref ${dados.referencia})`)
    try {
      await this.emailService.enviarAlertaOperacional({
        ...dados,
        titulo:    'Pagamento descartado sem licença',
        subtitulo: 'Nenhuma licença foi alterada — ação manual necessária',
        acao:      'Procure essa referência no painel do Stripe para identificar o cliente. Se o pagamento for legítimo, confirme manualmente pelo painel admin (Financeiro → confirmar pagamento) ou devolva o valor.',
      })
    } catch (err) {
      console.error('[alarme] falha ao enviar alerta de descarte:', err instanceof Error ? err.message : err)
    }
  }

  /**
   * O cliente clicou em pagar e o gateway recusou a criação do checkout. A causa
   * quase sempre é catálogo desalinhado — Price de outro modo (test/live), Price
   * arquivado, plano sem Price. É invisível no financeiro (não gera evento nenhum),
   * então só o alarme revela; para o cliente, é o sistema simplesmente não vender.
   */
  private async alarmarFalhaCheckout(dados: {
    motivo:     string
    referencia: string
  }) {
    console.error(`[alarme] falha ao criar checkout — ${dados.motivo} (licença ${dados.referencia})`)
    try {
      await this.emailService.enviarAlertaOperacional({
        titulo:     'Cliente não conseguiu iniciar o pagamento',
        subtitulo:  'O Stripe recusou a criação do checkout — nenhuma venda foi feita',
        evento:     'checkout.session.create',
        motivo:     dados.motivo,
        referencia: dados.referencia,
        valor:      null,
        acao:       'Confira se o Price do plano existe e está ativo no MESMO modo (test/live) da chave em uso. Price de teste não existe em live: nesse caso, recrie o catálogo em live e reaponte o plano.',
      })
    } catch (err) {
      console.error('[alarme] falha ao enviar alerta de checkout:', err instanceof Error ? err.message : err)
    }
  }

  // ── Helper: renovar licença + registrar pagamento + enviar e-mail ──────────

  private async processarRenovacao(params: {
    licenca:      Awaited<ReturnType<typeof findLicencaById>>
    meses:        number
    valor:        number
    /**
     * Base da comissão do parceiro, quando diferente do valor total.
     *
     * Existe por causa dos módulos avulsos: eles entram no valor cobrado mas não
     * são venda do parceiro. Omitido = o total inteiro é comissionável, que é o
     * caso de toda renovação sem módulo.
     */
    valorComissionavel?: number
    transacaoId:  string
    gateway:      string
    origem:       string
    descricao:    string
  }) {
    const { licenca, meses, valor, transacaoId, gateway, origem, descricao } = params
    const valorComissionavel = params.valorComissionavel ?? valor
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const nomeCliente = !!licenca.cliente.pf
      ? (licenca.cliente.pf?.nomeCompleto ?? licenca.cliente.email)
      : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

    const base = licenca.dataVencimento && licenca.dataVencimento > new Date()
      ? new Date(licenca.dataVencimento) : new Date()

    const dataVencimento = new Date(base)
    dataVencimento.setMonth(dataVencimento.getMonth() + meses)

    // Mantém a mesma chave — o ERP não precisa ser reconfigurado a cada renovação
    const chaveAtivacao = licenca.chaveAtivacao

    await renovarLicencaComHistorico(licenca.id, { chaveAtivacao, dataVencimento, meses, ultimoPagamento: new Date() })

    const pagamento = await criarPagamento({ licencaId: licenca.id, clienteId: licenca.clienteId, valor, meses, gateway, transacaoId })
    await criarTransacao({ clienteId: licenca.clienteId, licencaId: licenca.id, pagamentoId: pagamento.id, tipo: 'PAGAMENTO_RECEBIDO', valor, origem, descricao })

    // Funil único de checkout, renovação automática e Asaas — é aqui que a
    // comissão recorrente nasce, uma linha por pagamento, proporcional aos meses.
    await this.parceiroService.apurarComissao({
      id: pagamento.id, clienteId: licenca.clienteId, licencaId: licenca.id,
      // Só a parte do plano — módulo avulso não é venda do parceiro.
      valor: valorComissionavel, meses,
    })

    try {
      await this.emailService.enviarRenovacao({ email: licenca.cliente.email, nomeCliente, dataVencimento, nomeDispositivo: licenca.nomeDispositivo ?? 'Dispositivo' })
    } catch (err) {
      console.warn('[email] falha ao enviar confirmação de renovação:', err instanceof Error ? err.message : err)
    }

    // Avisa o celular do admin. Vem DEPOIS de tudo que importa já estar
    // gravado, e o serviço nunca propaga erro: notificação que falha não pode
    // desfazer uma renovação que já aconteceu e um cliente que já foi liberado.
    await this.notificacao.notificarPagamento({
      valor,
      metodo: NOME_DO_GATEWAY[gateway] ?? gateway,
    })

    // O pagamentoId sai junto para a cobrança PIX conseguir se ligar ao
    // lançamento que ela virou. Campo a mais na resposta; quem já consumia
    // (webhook do Stripe) ignora sem saber que existe.
    return { chaveAtivacao, dataVencimento, pagamentoId: pagamento.id }
  }
}
