/** Cria um Price recorrente DIÁRIO de R$10 no produto do Price base informado. */
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

async function main() {
  const priceBaseId = process.env.PRICE_BASE ?? 'price_1Ts1SVFuTAGh0hX5YUKjEFRr'
  const base: any = await stripe.prices.retrieve(priceBaseId)
  const productId = typeof base.product === 'string' ? base.product : base.product?.id
  if (!productId) throw new Error('Não achei o produto do Price base.')

  const novo = await stripe.prices.create({
    product:     productId,
    currency:    'brl',
    unit_amount: 1000, // R$10,00
    recurring:   { interval: 'day', interval_count: 1 },
    nickname:    'Plano Teste Diário — R$10/dia',
  })

  console.log('Price diário criado com sucesso!')
  console.log(`  produto:  ${productId}`)
  console.log(`  price_id: ${novo.id}`)
  console.log(`  intervalo: a cada ${novo.recurring?.interval_count} ${novo.recurring?.interval}`)
  console.log(`  valor:     ${(novo.currency ?? '').toUpperCase()} ${(novo.unit_amount ?? 0) / 100}`)
  console.log('\n>>> Use este price_id para atualizar o stripePriceId do plano no banco (na VPS).')
}
main().catch(e => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exitCode = 1 })
