/**
 * ============================================================================
 * SCRIPT DE DIAGNÓSTICO (somente leitura): conferir cobranças recorrentes
 * ============================================================================
 * PARA QUE SERVE:
 * Mostra, para cada licença que tem assinatura no Stripe, o estado real da
 * assinatura (status, intervalo de cobrança, valor) e as faturas/cobranças
 * recentes — pra validar se o cartão está sendo cobrado no ciclo esperado
 * (ex.: diariamente, num teste). Também mostra o que o nosso banco registrou.
 *
 * NÃO altera nada. Só lê do Stripe e do banco.
 *
 * COMO RODAR (na raiz do projeto):
 *   npx dotenv -e apps/server/.env -- tsx scripts/checar-cobranca-stripe.ts
 *
 * Opcional: filtrar por e-mail do cliente:
 *   CLIENTE_EMAIL="aalanallvesgt@gmail.com" \
 *     npx dotenv -e apps/server/.env -- tsx scripts/checar-cobranca-stripe.ts
 * ============================================================================
 */
import { prisma } from '@startbig/database'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

function ts(epochSeconds?: number | null) {
  if (!epochSeconds) return '—'
  return new Date(epochSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

async function main() {
  const modo = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live') ? 'LIVE (produção)' : 'TEST (teste)'
  console.log(`Stripe em modo: ${modo}\n`)

  const filtroEmail = process.env.CLIENTE_EMAIL?.trim()

  const licencas = await prisma.licenca.findMany({
    where: {
      stripeSubscriptionId: { not: null },
      ...(filtroEmail ? { cliente: { email: filtroEmail } } : {}),
    },
    include: {
      cliente: { select: { email: true } },
      plano:   { select: { nome: true } },
    },
    orderBy: { atualizadoEm: 'desc' },
  })

  if (licencas.length === 0) {
    console.log('Nenhuma licença com assinatura Stripe (stripeSubscriptionId) encontrada' +
      (filtroEmail ? ` para o e-mail ${filtroEmail}.` : '.'))
    console.log('Obs.: confirme que o DATABASE_URL deste .env aponta pro mesmo banco onde a assinatura de teste foi criada.')
    return
  }

  for (const lic of licencas) {
    const subId = lic.stripeSubscriptionId as string
    console.log('='.repeat(72))
    console.log(`Cliente: ${lic.cliente.email}   Plano: ${lic.plano.nome}`)
    console.log(`Licença: ${lic.id}`)
    console.log(`BANCO  → status: ${lic.status} | vencimento: ${lic.dataVencimento?.toISOString().slice(0,10) ?? '—'} | últimoPagamento: ${lic.ultimoPagamento?.toISOString().slice(0,19).replace('T',' ') ?? '—'}`)

    let sub: any
    try {
      sub = await stripe.subscriptions.retrieve(subId)
    } catch (e) {
      console.log(`STRIPE → ⚠ não consegui buscar a assinatura ${subId}: ${e instanceof Error ? e.message : e}`)
      continue
    }

    const item     = sub.items?.data?.[0]
    const price     = item?.price
    const rec       = price?.recurring
    const intervalo = rec ? `a cada ${rec.interval_count ?? 1} ${rec.interval}(s)` : '—'
    const valor     = price?.unit_amount != null ? `${(price.currency ?? '').toUpperCase()} ${(price.unit_amount / 100).toFixed(2)}` : '—'
    // current_period_end pode estar na assinatura ou no item, dependendo da versão da API
    const fimCiclo  = sub.current_period_end ?? item?.current_period_end

    console.log(`STRIPE → assinatura ${subId}`)
    console.log(`         status: ${sub.status} | cobrança: ${intervalo} | valor: ${valor}`)
    console.log(`         fim do ciclo atual: ${ts(fimCiclo)} | cancela no fim do ciclo: ${sub.cancel_at_period_end}`)

    // Faturas recentes do cliente, filtrando as dessa assinatura
    const custId   = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
    const invoices = await stripe.invoices.list({ customer: custId, limit: 20 })
    const daSub = invoices.data.filter((inv: any) =>
      inv.subscription === subId ||
      inv.parent?.subscription_details?.subscription === subId,
    )

    console.log(`         faturas/cobranças recentes desta assinatura: ${daSub.length}`)
    for (const inv of daSub as any[]) {
      const pago = ((inv.amount_paid ?? 0) / 100).toFixed(2)
      console.log(`           • ${ts(inv.created)} | ${inv.status} | pago: ${(inv.currency ?? '').toUpperCase()} ${pago} | motivo: ${inv.billing_reason ?? '—'}`)
    }
    if (daSub.length === 0) {
      console.log('           (nenhuma fatura ainda — 1º ciclo pode não ter fechado, ou cobrança não está ocorrendo)')
    }
  }
  console.log('='.repeat(72))
}

main()
  .catch((e) => {
    console.error('[checar-cobranca] ERRO:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
