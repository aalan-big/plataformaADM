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
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { ZodError } from 'zod'
import { randomUUID } from 'crypto'
import {
  findLicencaById,
  findLicencaByStripeSubscriptionId,
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
} from '@startbig/database'
import { confirmarPagamentoSchema, gerarCobrancaSchema } from '@startbig/schemas'
import { EmailService } from '../../core/email/email.service'
import { StripeService } from '../../common/stripe/stripe.service'

@Injectable()
export class FinanceiroService {
  constructor(
    private readonly stripeService: StripeService,
    private readonly emailService:  EmailService,
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

    const preco   = Number(plano.precoMensal)
    const descTri = plano.descontoTrimestral ? Number(plano.descontoTrimestral) / 100 : 0
    const descAnu = plano.descontoAnual      ? Number(plano.descontoAnual)      / 100 : 0

    const nome = licenca.cliente.tipo === 'PF'
      ? (licenca.cliente.pf?.nomeCompleto ?? licenca.cliente.email)
      : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

    return {
      licencaId,
      cliente:        { nome, email: licenca.cliente.email },
      plano:          plano.nome,
      status:         licenca.status,
      dataVencimento: licenca.dataVencimento,
      opcoes: [
        { meses: 1,  label: 'Mensal',      total: parseFloat(preco.toFixed(2)),                          desconto: 0       },
        { meses: 3,  label: 'Trimestral',  total: parseFloat((preco * 3  * (1 - descTri)).toFixed(2)),   desconto: descTri },
        { meses: 12, label: 'Anual',       total: parseFloat((preco * 12 * (1 - descAnu)).toFixed(2)),   desconto: descAnu },
      ],
    }
  }

  // ── Stripe Checkout (assinatura recorrente) ────────────────────────────────

  async gerarCobranca(body: unknown) {
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

    const plano = licenca.plano as any
    const preco   = Number(plano.precoMensal)
    const descTri = plano.descontoTrimestral ? Number(plano.descontoTrimestral) / 100 : 0
    const descAnu = plano.descontoAnual      ? Number(plano.descontoAnual)      / 100 : 0

    let totalBRL: number
    if (dados.meses === 3) {
      totalBRL = plano.precoTrimestral ? Number(plano.precoTrimestral) : preco * 3 * (1 - descTri)
    } else if (dados.meses === 12) {
      totalBRL = plano.precoAnual ? Number(plano.precoAnual) : preco * 12 * (1 - descAnu)
    } else {
      totalBRL = preco * dados.meses
    }

    const result = await this.stripeService.criarCheckoutSession({
      meses:         dados.meses,
      licencaId:     dados.licencaId,
      email:         licenca.cliente.email,
      totalCentavos: Math.round(totalBRL * 100),
    })

    return { url: result.url, sessionId: result.sessionId }
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

    const nomeCliente = licenca.cliente.tipo === 'PF'
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
      const { sessionId, subscriptionId, licencaId, meses, amountTotal, email } = (evento as any).dados

      const jaProcessado = await findPagamentoByTransacaoId(sessionId)
      if (jaProcessado) return { msg: 'Pagamento já processado' }

      if (!licencaId) return { msg: 'licencaId ausente nos metadados — ignorado' }

      const licenca = await findLicencaById(licencaId)
      if (!licenca) throw new NotFoundException('Licença não encontrada.')

      const resultado = await this.processarRenovacao({
        licenca, meses, valor: (amountTotal ?? 0) / 100, transacaoId: sessionId, gateway: 'STRIPE', origem: 'STRIPE',
        descricao: `Stripe checkout — ${meses} mês(es)`,
      })

      // Salva o ID da assinatura para mapear renovações futuras
      if (subscriptionId) {
        await updateLicenca(licencaId, { stripeSubscriptionId: subscriptionId })
      }

      return { msg: 'Pagamento inicial processado', data: resultado }
    }

    // ── 2. Renovação automática (Stripe cobra o cliente todo mês/trimestre/ano)
    if (evento.tipo === 'invoice.payment_succeeded') {
      const { subscriptionId, amountTotal, billingReason } = (evento as any).dados

      // Ignora a fatura do primeiro pagamento (já tratada acima)
      if (billingReason !== 'subscription_cycle') return { msg: `billing_reason "${billingReason}" ignorado` }
      if (!subscriptionId) return { msg: 'subscriptionId ausente — ignorado' }

      const licenca = await findLicencaByStripeSubscriptionId(subscriptionId)
      if (!licenca) return { msg: `Licença com subscription ${subscriptionId} não encontrada — ignorado` }

      const { meses } = await this.stripeService.buscarMetadadosSubscription(subscriptionId)

      const resultado = await this.processarRenovacao({
        licenca, meses, valor: amountTotal, transacaoId: `inv_${subscriptionId}_${Date.now()}`,
        gateway: 'STRIPE', origem: 'STRIPE', descricao: `Renovação automática Stripe — ${meses} mês(es)`,
      })

      return { msg: 'Renovação automática processada', data: resultado }
    }

    // ── 3. Assinatura cancelada ──────────────────────────────────────────────
    if (evento.tipo === 'customer.subscription.deleted') {
      const { subscriptionId } = (evento as any).dados
      const licenca = await findLicencaByStripeSubscriptionId(subscriptionId)
      if (licenca) {
        await updateLicenca(licenca.id, { status: 'BLOQUEADA' })
        return { msg: 'Assinatura cancelada — licença bloqueada' }
      }
      return { msg: 'Licença não encontrada para essa assinatura — ignorado' }
    }

    return { msg: `Evento ${evento.tipo} ignorado` }
  }

  async webhookAsaas(body: any) {
    // Exemplo de payload Asaas:
    // { event: 'PAYMENT_RECEIVED', payment: { id: '...', externalReference: 'licencaId', value: 100 } }
    
    if (!body || !body.event || !body.payment) {
      throw new BadRequestException('Formato de webhook Asaas inválido.')
    }

    if (body.event === 'PAYMENT_RECEIVED' || body.event === 'PAYMENT_CONFIRMED') {
      const { id: transacaoId, externalReference, value, description } = body.payment
      
      const licencaId = externalReference
      if (!licencaId) {
        return { msg: 'externalReference (licencaId) ausente no pagamento Asaas — ignorado' }
      }

      const licenca = await findLicencaById(licencaId)
      if (!licenca) {
        return { msg: `Licença não encontrada para externalReference ${licencaId} — ignorado` }
      }

      const jaProcessado = await findPagamentoByTransacaoId(transacaoId)
      if (jaProcessado) return { msg: 'Pagamento Asaas já processado' }

      // Como o Asaas não diz diretamente a quantidade de meses neste payload simplificado,
      // assumimos 1 mês como padrão (mensalidade), mas pode ser ajustado conforme a regra de negócio.
      const meses = 1

      const resultado = await this.processarRenovacao({
        licenca,
        meses,
        valor: value,
        transacaoId,
        gateway: 'ASAAS',
        origem: 'ASAAS',
        descricao: description || `Pagamento Asaas (${body.payment.billingType})`,
      })

      return { msg: 'Pagamento Asaas processado com sucesso', data: resultado }
    }

    return { msg: `Evento Asaas ${body.event} ignorado` }
  }

  // ── Helper: renovar licença + registrar pagamento + enviar e-mail ──────────

  private async processarRenovacao(params: {
    licenca:      Awaited<ReturnType<typeof findLicencaById>>
    meses:        number
    valor:        number
    transacaoId:  string
    gateway:      string
    origem:       string
    descricao:    string
  }) {
    const { licenca, meses, valor, transacaoId, gateway, origem, descricao } = params
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const nomeCliente = licenca.cliente.tipo === 'PF'
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

    try {
      await this.emailService.enviarRenovacao({ email: licenca.cliente.email, nomeCliente, dataVencimento, nomeDispositivo: licenca.nomeDispositivo ?? 'Dispositivo' })
    } catch (err) {
      console.warn('[email] falha ao enviar confirmação de renovação:', err instanceof Error ? err.message : err)
    }

    return { chaveAtivacao, dataVencimento }
  }
}
