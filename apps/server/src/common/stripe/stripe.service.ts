/**
 * ============================================================================
 * NOME DO ARQUIVO: stripe.service.ts
 * MÓDULO: CORE/GERAL
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de CORE/GERAL. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import Stripe from 'stripe'


export type CheckoutResult  = { url: string; sessionId: string }

export type EventoParsed =
  | {
      tipo:   'checkout.session.completed'
      dados:  {
        sessionId:      string
        subscriptionId: string | null
        licencaId:      string | null
        meses:          number
        amountTotal:    number | null
        email:          string | null
      }
    }
  | {
      tipo:  'invoice.payment_succeeded'
      dados: {
        invoiceId:      string
        subscriptionId: string
        amountTotal:    number
        billingReason:  string | null
        licencaId:      string | null
        meses:          number | null
      }
    }
  | {
      tipo:  'invoice.payment_failed'
      dados: { subscriptionId: string; licencaId: string | null }
    }
  | {
      tipo:  'customer.subscription.deleted'
      dados: { subscriptionId: string }
    }
  | { tipo: Exclude<string, 'checkout.session.completed' | 'invoice.payment_succeeded' | 'invoice.payment_failed' | 'customer.subscription.deleted'> }

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly stripe: any

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY não configurada')
    this.stripe = new Stripe(key)
    this.logger.log('StripeService iniciado')
  }

  async criarCheckoutSession(dados: {
    meses:         number
    licencaId:     string
    email:         string
    stripePriceId: string   // Price recorrente pré-criado no catálogo do Stripe
  }): Promise<CheckoutResult> {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const label  = dados.meses === 1 ? '1 mês' : `${dados.meses} meses`

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: dados.stripePriceId, quantity: 1 }],
      mode:           'subscription',
      customer_email: dados.email,
      success_url:    `${appUrl}/pagamento/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:     `${appUrl}/pagamento/cancelado`,
      metadata:       { licencaId: dados.licencaId, meses: String(dados.meses) },
      // A metadata precisa ir na ASSINATURA também: as renovações automáticas
      // (invoice.payment_succeeded) só enxergam a subscription, não a session.
      subscription_data: {
        metadata: { licencaId: dados.licencaId, meses: String(dados.meses) },
      },
    })

    this.logger.log(`Checkout Session (assinatura) criada: ${session.id} → licença ${dados.licencaId} (${label}, price ${dados.stripePriceId})`)
    return { url: session.url!, sessionId: session.id }
  }

  parsearEvento(rawBody: Buffer, signature: string): EventoParsed {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET não configurada')

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, secret)

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as any
      return {
        tipo:  'checkout.session.completed',
        dados: {
          sessionId:      s.id,
          subscriptionId: typeof s.subscription === 'string' ? s.subscription : null,
          licencaId:      s.metadata?.licencaId   ?? null,
          meses:          parseInt(s.metadata?.meses ?? '1') || 1,
          amountTotal:    s.amount_total,
          email:          s.customer_email,
        },
      }
    }

    if (event.type === 'invoice.payment_succeeded') {
      const inv = event.data.object as any
      const { subscriptionId, licencaId, meses } = this.extrairDadosFatura(inv)
      return {
        tipo:  'invoice.payment_succeeded',
        dados: {
          invoiceId:     inv.id,
          subscriptionId,
          amountTotal:   inv.amount_paid / 100,
          billingReason: inv.billing_reason ?? null,
          licencaId,
          meses,
        },
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object as any
      const { subscriptionId, licencaId } = this.extrairDadosFatura(inv)
      return { tipo: 'invoice.payment_failed', dados: { subscriptionId, licencaId } }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as any
      return { tipo: 'customer.subscription.deleted', dados: { subscriptionId: sub.id } }
    }

    return { tipo: event.type }
  }

  /**
   * Extrai assinatura + metadata (licencaId/meses) de uma fatura, lidando com o
   * novo formato da API 2025+ (dahlia): `invoice.subscription` foi movido para
   * `invoice.parent.subscription_details`. Mantém fallback para o campo antigo.
   */
  private extrairDadosFatura(inv: any): { subscriptionId: string; licencaId: string | null; meses: number | null } {
    const subDetails = inv.parent?.subscription_details ?? null
    const rawSub     = subDetails?.subscription ?? inv.subscription
    const subscriptionId = typeof rawSub === 'string' ? rawSub : (rawSub?.id ?? '')
    const metadata   = subDetails?.metadata ?? {}
    return {
      subscriptionId,
      licencaId: metadata.licencaId ?? null,
      meses:     parseInt(metadata.meses ?? '') || null,
    }
  }

  async buscarMetadadosSubscription(subscriptionId: string): Promise<{ licencaId: string | null; meses: number }> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    return {
      licencaId: sub.metadata?.licencaId ?? null,
      meses:     parseInt(sub.metadata?.meses ?? '1') || 1,
    }
  }

  async cancelarSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId)
    this.logger.log(`Subscription cancelada: ${subscriptionId}`)
  }

  /**
   * Descobre o período de cobrança de uma assinatura (mensal/trimestral/anual),
   * a partir do intervalo do preço atual. Usado na troca de plano para escolher
   * o Price equivalente do novo plano (mantém o mesmo período de cobrança).
   */
  async periodoDaSubscription(subscriptionId: string): Promise<'mensal' | 'trimestral' | 'anual'> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    const rec = sub.items?.data?.[0]?.price?.recurring
    const interval = rec?.interval
    const count    = rec?.interval_count ?? 1
    if (interval === 'year') return 'anual'
    if (interval === 'month' && count === 3) return 'trimestral'
    return 'mensal'
  }

  /**
   * Troca o Price de uma assinatura existente (mesma assinatura, cartão já salvo).
   * - quando = 'imediato'     → upgrade: cobra a diferença proporcional AGORA (proration).
   * - quando = 'fim_do_ciclo' → downgrade: sem cobrança/estorno agora; o novo preço
   *   passa a valer só na próxima fatura (fim do período já pago).
   */
  async atualizarPrecoSubscription(
    subscriptionId: string,
    novoPriceId:    string,
    quando:         'imediato' | 'fim_do_ciclo',
  ): Promise<void> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    const itemId = sub.items?.data?.[0]?.id
    if (!itemId) throw new BadRequestException('Assinatura sem item de cobrança — não foi possível trocar o plano.')

    await this.stripe.subscriptions.update(subscriptionId, {
      items:              [{ id: itemId, price: novoPriceId }],
      proration_behavior: quando === 'imediato' ? 'always_invoice' : 'none',
    })

    this.logger.log(`Plano da subscription ${subscriptionId} trocado para ${novoPriceId} (${quando})`)
  }
}
