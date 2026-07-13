/**
 * DIAGNÓSTICO (somente leitura) — consulta o Stripe DIRETO, sem depender do banco.
 * Lista as assinaturas (subscriptions) da conta e, para cada uma, o intervalo de
 * cobrança, o status e as faturas/cobranças recentes — pra ver se o cartão está
 * sendo cobrado no ciclo esperado (ex.: diariamente num teste).
 *
 * RODAR:  npx dotenv -e apps/server/.env -- tsx scripts/checar-stripe-direto.ts
 * Filtrar por e-mail (opcional): CLIENTE_EMAIL="..." antes do comando.
 */
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

function ts(s?: number | null) {
  return s ? new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ') : '—'
}

async function main() {
  const modo = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live') ? 'LIVE (produção)' : 'TEST (teste)'
  console.log(`Stripe em modo: ${modo}`)
  try {
    const acct = await stripe.accounts.retrieve()
    console.log(`Conta: ${acct.id}${acct.settings?.dashboard?.display_name ? ' (' + acct.settings.dashboard.display_name + ')' : ''}\n`)
  } catch { /* ignora se a chave não permite ler a conta */ }

  const email = process.env.CLIENTE_EMAIL?.trim()

  let subs: any[] = []
  if (email) {
    const custs = await stripe.customers.list({ email, limit: 20 })
    if (custs.data.length === 0) { console.log(`Nenhum customer no Stripe com e-mail ${email}.`); return }
    for (const c of custs.data) {
      const s = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 })
      subs.push(...s.data)
    }
  } else {
    const s = await stripe.subscriptions.list({ status: 'all', limit: 30 })
    subs = s.data
  }

  if (subs.length === 0) { console.log('Nenhuma assinatura encontrada na conta.'); return }
  console.log(`Assinaturas encontradas: ${subs.length}\n`)

  for (const sub of subs as any[]) {
    const item     = sub.items?.data?.[0]
    const price    = item?.price
    const rec      = price?.recurring
    const intervalo = rec ? `a cada ${rec.interval_count ?? 1} ${rec.interval}(s)` : '—'
    const valor    = price?.unit_amount != null ? `${(price.currency ?? '').toUpperCase()} ${(price.unit_amount / 100).toFixed(2)}` : '—'
    const custId   = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
    const custEmail = typeof sub.customer === 'object' ? sub.customer?.email : undefined

    console.log('='.repeat(72))
    console.log(`Assinatura: ${sub.id}`)
    console.log(`Cliente:    ${custEmail ?? custId}`)
    console.log(`Status:     ${sub.status} | Cobrança: ${intervalo} | Valor: ${valor}`)
    console.log(`Criada:     ${ts(sub.created)} | Fim do ciclo atual: ${ts(sub.current_period_end ?? item?.current_period_end)}`)
    console.log(`Cancela no fim do ciclo: ${sub.cancel_at_period_end}`)

    const invs = await stripe.invoices.list({ customer: custId, limit: 30 })
    const daSub = (invs.data as any[]).filter(inv =>
      inv.subscription === sub.id ||
      inv.parent?.subscription_details?.subscription === sub.id,
    )
    console.log(`Cobranças (faturas) desta assinatura: ${daSub.length}`)
    for (const inv of daSub) {
      const pago = ((inv.amount_paid ?? 0) / 100).toFixed(2)
      console.log(`  • ${ts(inv.created)} | ${inv.status} | pago: ${(inv.currency ?? '').toUpperCase()} ${pago} | motivo: ${inv.billing_reason ?? '—'}`)
    }
    if (daSub.length === 0) console.log('  (sem faturas ainda)')
  }
  console.log('='.repeat(72))
}

main().catch((e) => {
  console.error('[checar-stripe] ERRO:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
