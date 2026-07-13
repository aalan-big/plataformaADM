/** Leitura: mostra o Price da assinatura de R$10 e lista todos os Prices recorrentes da conta. */
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

async function main() {
  const subId = process.env.SUB_ID ?? 'sub_1Ts1YWFuTAGh0hX5aEovqLlW'
  const sub: any = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price.product'] })
  const p: any = sub.items?.data?.[0]?.price
  console.log(`Assinatura ${subId}:`)
  console.log(`  price: ${p?.id}`)
  console.log(`  intervalo: a cada ${p?.recurring?.interval_count ?? 1} ${p?.recurring?.interval}`)
  console.log(`  valor: ${(p?.currency ?? '').toUpperCase()} ${(p?.unit_amount ?? 0) / 100}`)
  console.log(`  produto: ${typeof p?.product === 'object' ? p.product.name : p?.product}\n`)

  console.log('Todos os Prices recorrentes ATIVOS da conta:')
  const prices = await stripe.prices.list({ active: true, type: 'recurring', limit: 100, expand: ['data.product'] })
  for (const pr of prices.data as any[]) {
    const nome = typeof pr.product === 'object' ? pr.product.name : pr.product
    console.log(`  • ${pr.id} | a cada ${pr.recurring?.interval_count ?? 1} ${pr.recurring?.interval} | ${(pr.currency ?? '').toUpperCase()} ${(pr.unit_amount ?? 0) / 100} | ${nome}`)
  }
  const temDiario = (prices.data as any[]).some(pr => pr.recurring?.interval === 'day')
  console.log(`\nExiste algum Price com intervalo DIÁRIO na conta? ${temDiario ? 'SIM' : 'NÃO'}`)
}
main().catch(e => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exitCode = 1 })
