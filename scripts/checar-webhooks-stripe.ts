/** Leitura: lista os webhook endpoints configurados na conta Stripe e os eventos que escutam. */
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

async function main() {
  const modo = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live') ? 'LIVE' : 'TEST'
  console.log(`Modo: ${modo}\n`)
  const eps = await stripe.webhookEndpoints.list({ limit: 20 })
  if (eps.data.length === 0) {
    console.log('⚠ Nenhum webhook endpoint configurado nesta conta/modo.')
    console.log('  Sem webhook, cobranças recorrentes NÃO chegam no seu financeiro.')
    return
  }
  for (const ep of eps.data as any[]) {
    console.log(`• ${ep.url}`)
    console.log(`  status: ${ep.status} | eventos: ${(ep.enabled_events ?? []).join(', ')}`)
    console.log('')
  }
}
main().catch(e => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exitCode = 1 })
