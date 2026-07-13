/**
 * Test Clock (modo teste): cria uma assinatura no price DIÁRIO com cartão de teste,
 * avança +N dias e dispara as cobranças recorrentes — pra validar HOJE que cobra
 * R$10 por dia e que o webhook cai no financeiro.
 *
 * A assinatura leva metadata { licencaId, meses } pra o webhook renovar a licença
 * certa e registrar o pagamento no financeiro.
 *
 * RODAR:
 *   LICENCA_ID="<uuid-da-licenca>" DIAS="1" \
 *     npx dotenv -e apps/server/.env -- tsx scripts/test-clock-diario.ts
 */
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

const PRICE_ID  = process.env.PRICE_ID ?? 'price_1TsoO8FuTAGh0hX5F65PmBmS' // diário R$10
const LICENCA_ID = process.env.LICENCA_ID
const DIAS      = parseInt(process.env.DIAS ?? '1') || 1

function fmt(inv: any) {
  const dt = new Date((inv.created ?? 0) * 1000).toISOString().slice(0, 19).replace('T', ' ')
  return `${dt} | ${inv.status} | pago ${(inv.currency ?? '').toUpperCase()} ${((inv.amount_paid ?? 0) / 100).toFixed(2)} | ${inv.billing_reason ?? '—'}`
}

async function main() {
  if (!LICENCA_ID) throw new Error('Defina LICENCA_ID (vai no metadata p/ o webhook achar a licença).')

  console.log(`Price diário: ${PRICE_ID} | Licença: ${LICENCA_ID} | Avançar: +${DIAS} dia(s)\n`)

  const agora = Math.floor(Date.now() / 1000)
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: agora, name: 'Teste cobrança diária' })
  console.log(`1) Test clock criado: ${clock.id}`)

  const customer = await stripe.customers.create({
    name:             'Cliente Teste Diário',
    email:            'teste-diario@startbig.local',
    test_clock:       clock.id,
    payment_method:   'pm_card_visa',
    invoice_settings: { default_payment_method: 'pm_card_visa' },
  })
  console.log(`2) Customer no clock: ${customer.id} (cartão de teste anexado)`)

  const sub: any = await stripe.subscriptions.create({
    customer:               customer.id,
    items:                  [{ price: PRICE_ID }],
    default_payment_method: 'pm_card_visa',
    metadata:               { licencaId: LICENCA_ID, meses: '1' },
  })
  console.log(`3) Assinatura criada: ${sub.id} | status: ${sub.status}  (1ª cobrança de hoje)`)

  // Avança o relógio +N dias → dispara a cobrança do próximo ciclo
  const alvo = agora + DIAS * 24 * 60 * 60
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: alvo })
  process.stdout.write(`4) Avançando o relógio +${DIAS} dia(s)`)
  let c = await stripe.testHelpers.testClocks.retrieve(clock.id)
  while (c.status === 'advancing') {
    process.stdout.write('.')
    await new Promise(r => setTimeout(r, 3000))
    c = await stripe.testHelpers.testClocks.retrieve(clock.id)
  }
  console.log(`\n   relógio: ${c.status}\n`)

  const invs = await stripe.invoices.list({ customer: customer.id, limit: 10 })
  console.log(`Faturas (cobranças) geradas: ${invs.data.length}`)
  for (const inv of invs.data as any[]) console.log(`  • ${fmt(inv)}`)

  console.log(`\nResumo → clock:${clock.id}  customer:${customer.id}  sub:${sub.id}`)
  console.log('Agora confira seu FINANCEIRO: deve aparecer o(s) pagamento(s) de R$10 nesta licença.')
}
main().catch(e => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exitCode = 1 })
