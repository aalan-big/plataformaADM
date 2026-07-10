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
      dados: { subscriptionId: string; amountTotal: number; billingReason: string | null }
    }
  | {
      tipo:  'customer.subscription.deleted'
      dados: { subscriptionId: string }
    }
  | { tipo: Exclude<string, 'checkout.session.completed' | 'invoice.payment_succeeded' | 'customer.subscription.deleted'> }

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
      return {
        tipo:  'invoice.payment_succeeded',
        dados: {
          subscriptionId: typeof inv.subscription === 'string' ? inv.subscription : '',
          amountTotal:    inv.amount_paid / 100,
          billingReason:  inv.billing_reason ?? null,
        },
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as any
      return { tipo: 'customer.subscription.deleted', dados: { subscriptionId: sub.id } }
    }

    return { tipo: event.type }
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
}
