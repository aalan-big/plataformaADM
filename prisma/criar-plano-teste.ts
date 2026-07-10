/**
 * Cria (em modo de TESTE, pois usa a STRIPE_SECRET_KEY sk_test) os 3 produtos/preços
 * recorrentes do "Plano Teste" no Stripe e cadastra/atualiza o plano no nosso banco
 * com os Price IDs gerados.
 *
 * Rodar:  npx dotenv -e apps/server/.env -- tsx prisma/criar-plano-teste.ts
 */
import Stripe from 'stripe'
import { prisma, findPlanoByNome, criarPlano, updatePlano } from '@startbig/database'

const NOME_PLANO = 'Plano Teste'

// Preços em centavos (BRL)
const PRECOS = {
  mensal:     { valor: 4990,  label: 'Mensal',     recurring: { interval: 'month' as const, interval_count: 1 } },
  trimestral: { valor: 14290, label: 'Trimestral', recurring: { interval: 'month' as const, interval_count: 3 } },
  anual:      { valor: 56590, label: 'Anual',       recurring: { interval: 'year'  as const, interval_count: 1 } },
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY não configurada no apps/server/.env')
  if (!key.startsWith('sk_test')) {
    throw new Error(`ABORTADO: a chave não é sk_test (é "${key.slice(0, 8)}..."). Este script só deve rodar em modo de TESTE.`)
  }
  const stripe = new Stripe(key)

  const priceIds: Record<string, string> = {}

  for (const [chave, cfg] of Object.entries(PRECOS)) {
    const produto = await stripe.products.create({
      name: `${NOME_PLANO} — ${cfg.label}`,
    })
    const price = await stripe.prices.create({
      product:     produto.id,
      currency:    'brl',
      unit_amount: cfg.valor,
      recurring:   cfg.recurring,
    })
    priceIds[chave] = price.id
    console.log(`[stripe] ${cfg.label.padEnd(11)} → produto ${produto.id} | price ${price.id} (R$ ${(cfg.valor / 100).toFixed(2)})`)
  }

  const dados = {
    nome:                    NOME_PLANO,
    limiteUsuario:           1,
    precoMensal:             PRECOS.mensal.valor / 100,
    precoTrimestral:         PRECOS.trimestral.valor / 100,
    precoAnual:              PRECOS.anual.valor / 100,
    stripePriceIdMensal:     priceIds.mensal,
    stripePriceIdTrimestral: priceIds.trimestral,
    stripePriceIdAnual:      priceIds.anual,
  }

  const existente = await findPlanoByNome(NOME_PLANO)
  const plano = existente
    ? await updatePlano(existente.id, dados)
    : await criarPlano(dados)

  console.log(`\n[db] Plano ${existente ? 'ATUALIZADO' : 'CRIADO'}: ${plano.nome} (id ${plano.id})`)
  console.log('\n✅ Pronto. Agora no /debug: crie um cliente + uma licença nesse plano e gere a cobrança.')
}

main()
  .catch((e) => { console.error('\n❌ Erro:', e instanceof Error ? e.message : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
