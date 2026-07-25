/**
 * Remove os planos de teste do catálogo — banco e Stripe.
 *
 * POR PADRÃO NÃO ALTERA NADA: roda em modo relatório, mostrando exatamente o que
 * seria feito e o que está impedindo. Só age com CONFIRMAR=sim.
 *
 * O que ele faz, nessa ordem, para cada plano alvo:
 *   1. Conta as licenças vinculadas (por status). Licença é relação obrigatória e
 *      sem onDelete no schema — enquanto existir uma, o Postgres recusa o DELETE.
 *   2. Cancela assinaturas do Stripe vivas nos Prices desse plano (senão elas
 *      continuam faturando e disparando webhook depois do plano sumir).
 *   3. Arquiva os Prices e o produto no Stripe (`active: false`). Stripe não apaga
 *      produto com Price — arquivar é o equivalente.
 *   4. Apaga o plano do banco se não sobrou licença nenhuma; se sobrou, apenas
 *      marca status INATIVO e diz quantas licenças seguram a exclusão.
 *
 * RODAR (relatório, não muda nada):
 *   npx dotenv -e apps/server/.env -- tsx prisma/limpar-planos-teste.ts
 *
 * RODAR (executando de verdade):
 *   CONFIRMAR=sim npx dotenv -e apps/server/.env -- tsx prisma/limpar-planos-teste.ts
 *
 * Opcional: PLANOS="Plano Teste,Plano Teste Diário" para mudar a lista de alvos.
 */
import Stripe from 'stripe'
import { prisma } from '@startbig/database'

/**
 * Só o diário por padrão. O "Plano Teste" comum fica no catálogo por decisão do
 * dono do projeto. O diário é o perigoso: cobra a cada 1 dia, então em live um
 * cliente que caísse nele teria o cartão debitado diariamente.
 */
const ALVOS_PADRAO = ['Plano Teste Diário']

async function main() {
  const alvos = (process.env.PLANOS ?? ALVOS_PADRAO.join(','))
    .split(',').map(s => s.trim()).filter(Boolean)

  const executar = process.env.CONFIRMAR === 'sim'

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY não configurada no .env usado.')
  const ehLive = /^(sk|rk)_live_/.test(key)   // cobre chave secreta e restrita
  const stripe = new Stripe(key)

  console.log(`Modo Stripe: ${ehLive ? 'LIVE' : 'TEST'}`)
  console.log(`Ação:        ${executar ? 'EXECUTANDO (altera banco e Stripe)' : 'RELATÓRIO (nada será alterado)'}`)
  console.log(`Alvos:       ${alvos.join(' | ')}\n`)

  for (const nome of alvos) {
    console.log('─'.repeat(70))
    const plano = await prisma.plano.findFirst({ where: { nome } })
    if (!plano) { console.log(`"${nome}": não existe no banco — nada a fazer.\n`); continue }

    console.log(`"${plano.nome}"  (id ${plano.id}, status ${plano.status})`)

    // 1. Licenças vinculadas
    const licencas = await prisma.licenca.groupBy({
      by:     ['status'],
      where:  { planoId: plano.id },
      _count: { _all: true },
    })
    const total = licencas.reduce((s, l) => s + l._count._all, 0)
    console.log(`  licenças vinculadas: ${total}${total ? ' → ' + licencas.map(l => `${l.status}=${l._count._all}`).join(', ') : ''}`)

    // 2 e 3. Stripe: assinaturas vivas, Prices e produto
    const priceIds = [plano.stripePriceIdMensal, plano.stripePriceIdTrimestral, plano.stripePriceIdAnual].filter(Boolean) as string[]
    const produtoIds = new Set<string>()

    // Descobre os produtos a partir dos Prices gravados no plano...
    for (const priceId of priceIds) {
      try {
        const price = await stripe.prices.retrieve(priceId)
        if (typeof price.product === 'string') produtoIds.add(price.product)
      } catch {
        console.log(`  price ${priceId}: não existe nesta conta/modo — ignorado`)
      }
    }

    // ...e trabalha sobre TODOS os Prices de cada produto, não só os do registro.
    // Um produto costuma acumular Prices antigos (valor alterado, período de teste)
    // que o plano não referencia — e uma assinatura viva num deles continua faturando
    // e batendo no webhook mesmo depois do produto arquivado.
    for (const produtoId of produtoIds) {
      for await (const price of stripe.prices.list({ product: produtoId, limit: 100 })) {
        for await (const sub of stripe.subscriptions.list({ price: price.id, status: 'all', limit: 100 })) {
          if (!['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) continue
          console.log(`  assinatura VIVA ${sub.id} (${sub.status}) no price ${price.id}`)
          if (executar) {
            await stripe.subscriptions.cancel(sub.id)
            console.log(`    → cancelada`)
          }
        }

        if (price.active) {
          console.log(`  price ${price.id}: ativo → arquivar`)
          if (executar) await stripe.prices.update(price.id, { active: false })
        }
      }

      console.log(`  produto ${produtoId}: arquivar`)
      if (executar) await stripe.products.update(produtoId, { active: false })
    }

    // 4. Banco
    if (total > 0) {
      console.log(`  banco: NÃO dá para apagar — ${total} licença(s) apontam para este plano.`)
      console.log(`         ação: marcar INATIVO (sai do catálogo, histórico preservado).`)
      if (executar && plano.status !== 'INATIVO') {
        await prisma.plano.update({ where: { id: plano.id }, data: { status: 'INATIVO' } })
        console.log(`         → marcado INATIVO`)
      }
    } else {
      console.log(`  banco: sem licenças → pode apagar de vez.`)
      if (executar) {
        await prisma.plano.delete({ where: { id: plano.id } })
        console.log(`         → APAGADO`)
      }
    }
    console.log('')
  }

  console.log('─'.repeat(70))
  if (!executar)
    console.log('Nada foi alterado. Para executar: CONFIRMAR=sim npx dotenv -e apps/server/.env -- tsx prisma/limpar-planos-teste.ts')
}

main()
  .catch((e) => { console.error('\nErro:', e instanceof Error ? e.message : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
