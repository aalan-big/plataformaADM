/**
 * DIAGNÓSTICO (somente leitura) — confere se os Price IDs salvos nos PLANOS do banco
 * existem no Stripe com a chave atual do .env. Mostra o modo (test/live) e, plano por
 * plano, se cada Price bate ("OK") ou está quebrado ("No such price").
 *
 * É exatamente o que derruba "gerar link" e "trocar plano" sem erro no log:
 * o servidor pede um Price ao Stripe, o Stripe (no modo da chave atual) não acha,
 * e vira BadRequestException que só aparece no painel.
 *
 * RODAR NA VPS:
 *   npx dotenv -e apps/server/.env -- tsx scripts/checar-planos-stripe.ts
 */
import Stripe from 'stripe'
import { prisma } from '@startbig/database'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

async function verificaPrice(id?: string | null) {
  if (!id) return { estado: 'vazio' as const }
  try {
    const p: any = await stripe.prices.retrieve(id)
    const val  = p.unit_amount != null ? `${(p.currency || '').toUpperCase()} ${(p.unit_amount / 100).toFixed(2)}` : '—'
    const intr = p.recurring ? `a cada ${p.recurring.interval_count ?? 1} ${p.recurring.interval}` : 'sem recorrência'
    return { estado: 'ok' as const, info: `${val} | ${intr}${p.active ? '' : ' | ⚠ INATIVO'}` }
  } catch (e: any) {
    return { estado: 'erro' as const, msg: e?.message ?? String(e) }
  }
}

async function main() {
  const key  = process.env.STRIPE_SECRET_KEY ?? ''
  const modo = key.startsWith('sk_live') ? 'LIVE (produção)' : key.startsWith('sk_test') ? 'TEST (teste)' : 'DESCONHECIDO'
  console.log(`Chave Stripe no .env: ${key.slice(0, 12)}... → modo ${modo}`)
  try {
    const acct: any = await stripe.accounts.retrieve()
    console.log(`Conta Stripe: ${acct.id}\n`)
  } catch (e: any) {
    console.log(`(não consegui ler a conta: ${e?.message})\n`)
  }

  const planos = await prisma.plano.findMany({ orderBy: { nome: 'asc' } })
  if (planos.length === 0) { console.log('Nenhum plano no banco.'); return }

  let quebrados = 0
  for (const pl of planos) {
    console.log('='.repeat(72))
    console.log(`Plano: ${pl.nome}  (status: ${pl.status})`)
    const campos = [
      ['mensal',     pl.stripePriceIdMensal],
      ['trimestral', pl.stripePriceIdTrimestral],
      ['anual',      pl.stripePriceIdAnual],
    ] as const
    for (const [campo, id] of campos) {
      const r = await verificaPrice(id)
      if (r.estado === 'vazio')    console.log(`  ${campo.padEnd(11)} → (vazio)`)
      else if (r.estado === 'ok')  console.log(`  ${campo.padEnd(11)} → OK    ${id}  |  ${r.info}`)
      else { quebrados++;          console.log(`  ${campo.padEnd(11)} → ERRO  ${id}  |  ✗ ${r.msg}`) }
    }
  }
  console.log('='.repeat(72))
  console.log(quebrados === 0
    ? '✔ Todos os Price IDs preenchidos existem no modo atual — o problema NÃO é o preço do plano.'
    : `✗ ${quebrados} Price ID(s) quebrado(s) no modo atual — é isso que derruba "gerar link" e "trocar plano".`)
}

main()
  .catch((e) => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
