import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import Stripe from 'stripe'

// Mapeamento de meses → Price ID configurado no dashboard do Stripe
const PRICE_MAP: Record<number, string | undefined> = {
  1:  process.env.STRIPE_PRICE_MENSAL,
  3:  process.env.STRIPE_PRICE_TRIMESTRAL,
  12: process.env.STRIPE_PRICE_ANUAL,
}

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
  | { tipo: string }

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name)
  private readonly stripe: Stripe

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY não configurada')
    this.stripe = new Stripe(key)
    this.logger.log('StripeService iniciado')
  }

  priceIdParaMeses(meses: number): string {
    const id = PRICE_MAP[meses]
    if (!id) throw new BadRequestException(
      `Price ID para ${meses} meses não configurado. Verifique STRIPE_PRICE_MENSAL / TRIMESTRAL / ANUAL no .env`
    )
    return id
  }

  async criarCheckoutSession(dados: {
    meses:     number
    licencaId: string
    email:     string
  }): Promise<CheckoutResult> {
    const priceId = this.priceIdParaMeses(dados.meses)
    const appUrl  = process.env.APP_URL ?? 'http://localhost:3000'

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card', 'boleto'],
      line_items:  [{ price: priceId, quantity: 1 }],
      mode:        'subscription',
      customer_email: dados.email,
      success_url: `${appUrl}/pagamento/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/pagamento/cancelado`,
      metadata:    { licencaId: dados.licencaId, meses: String(dados.meses) },
      subscription_data: {
        metadata:  { licencaId: dados.licencaId, meses: String(dados.meses) },
      },
    })

    this.logger.log(`Checkout Session criada: ${session.id} → licença ${dados.licencaId}`)
    return { url: session.url!, sessionId: session.id }
  }

  parsearEvento(rawBody: Buffer, signature: string): EventoParsed {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET não configurada')

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, secret)

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session
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
      const inv = event.data.object as Stripe.Invoice
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
      const sub = event.data.object as Stripe.Subscription
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
