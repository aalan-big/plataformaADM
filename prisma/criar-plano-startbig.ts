/**
 * Cria o "Plano StartBIG" no Stripe (produto + 3 Prices recorrentes) e cadastra/atualiza
 * o plano no banco com os Price IDs gerados.
 *
 * MODELO COMERCIAL: quem assina é o PARCEIRO, a R$ 59,90/mês por licença colocada.
 * O parceiro revende ao cliente final por R$ 89,90 e fica com os R$ 30 de diferença.
 * A margem do parceiro NÃO passa pelo sistema — o Stripe cobra só os R$ 59,90.
 *
 * O modo (test/live) vem do prefixo da STRIPE_SECRET_KEY do .env usado. Em live o
 * script exige confirmação explícita, porque a partir daí o Price cobra dinheiro real.
 *
 * RODAR (teste, na máquina local):
 *   npx dotenv -e apps/server/.env -- tsx prisma/criar-plano-startbig.ts
 *
 * RODAR (live, NA VPS, para gravar no banco de produção):
 *   CONFIRMAR_LIVE=sim npx dotenv -e apps/server/.env -- tsx prisma/criar-plano-startbig.ts
 *
 * Opcional: LIMITE_USUARIO=3 para mudar o limite de usuários do plano (padrão 1).
 *
 * É idempotente: rodar de novo reaproveita o produto e os Prices já existentes em vez
 * de duplicar o catálogo. Price no Stripe é imutável — mudar valor exige criar outro.
 */
import Stripe from 'stripe'
import { prisma, findPlanoByNome, criarPlano, updatePlano } from '@startbig/database'

const NOME_PLANO = 'Plano StartBIG'

/** Preço de VENDA sugerido ao cliente final, por mês. Só informativo — não vai pro Stripe. */
const PRECO_REVENDA_MENSAL = 89.90

// Valores em centavos (BRL) — é sempre o que o PARCEIRO paga.
const PRECOS = {
  mensal:     { valor:  5990, label: 'Mensal',     recurring: { interval: 'month' as const, interval_count: 1 } },
  trimestral: { valor: 17190, label: 'Trimestral', recurring: { interval: 'month' as const, interval_count: 3 } },
  anual:      { valor: 67990, label: 'Anual',      recurring: { interval: 'year'  as const, interval_count: 1 } },
}

/** Acha um produto ativo pelo nome exato, para o script não duplicar o catálogo a cada execução. */
async function acharProduto(stripe: Stripe, nome: string) {
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.name === nome) return p
  }
  return null
}

/** Acha um Price ativo do produto com exatamente o mesmo valor e periodicidade. */
async function acharPrice(stripe: Stripe, produtoId: string, valor: number, rec: { interval: 'month' | 'year'; interval_count: number }) {
  for await (const p of stripe.prices.list({ product: produtoId, active: true, limit: 100 })) {
    if (
      p.unit_amount === valor &&
      p.currency === 'brl' &&
      p.recurring?.interval === rec.interval &&
      (p.recurring?.interval_count ?? 1) === rec.interval_count
    ) return p
  }
  return null
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY não configurada no .env usado.')

  const ehLive = key.startsWith('sk_live')
  console.log(`Modo: ${ehLive ? 'LIVE — dinheiro real' : 'TEST'}\n`)

  if (ehLive && process.env.CONFIRMAR_LIVE !== 'sim') {
    throw new Error(
      'ABORTADO: chave sk_live detectada. Em live este script cria Prices que cobram de verdade.\n' +
      '   Se é isso mesmo que você quer, rode de novo com CONFIRMAR_LIVE=sim.',
    )
  }

  const stripe = new Stripe(key)
  const limiteUsuario = Number(process.env.LIMITE_USUARIO ?? 1) || 1

  const produto =
    (await acharProduto(stripe, NOME_PLANO)) ??
    (await stripe.products.create({
      name:        NOME_PLANO,
      description: `Licença StartBig ERP — assinatura do parceiro (revenda sugerida R$ ${PRECO_REVENDA_MENSAL.toFixed(2)}/mês ao cliente final)`,
    }))
  console.log(`[stripe] produto ${produto.id} (${produto.name})`)

  const priceIds: Record<string, string> = {}

  for (const [chave, cfg] of Object.entries(PRECOS)) {
    const existente = await acharPrice(stripe, produto.id, cfg.valor, cfg.recurring)
    const price = existente ?? (await stripe.prices.create({
      product:     produto.id,
      currency:    'brl',
      unit_amount: cfg.valor,
      recurring:   cfg.recurring,
    }))
    priceIds[chave] = price.id
    console.log(`[stripe] ${cfg.label.padEnd(11)} → ${price.id}  R$ ${(cfg.valor / 100).toFixed(2)}  ${existente ? '(reaproveitado)' : '(criado)'}`)
  }

  const dados = {
    nome:                    NOME_PLANO,
    limiteUsuario,
    precoMensal:             PRECOS.mensal.valor     / 100,
    precoTrimestral:         PRECOS.trimestral.valor / 100,
    precoAnual:              PRECOS.anual.valor      / 100,
    stripePriceIdMensal:     priceIds.mensal,
    stripePriceIdTrimestral: priceIds.trimestral,
    stripePriceIdAnual:      priceIds.anual,
  }

  const jaExiste = await findPlanoByNome(NOME_PLANO)
  const plano = jaExiste ? await updatePlano(jaExiste.id, dados) : await criarPlano(dados)

  console.log(`\n[db] Plano ${jaExiste ? 'ATUALIZADO' : 'CRIADO'}: ${plano.nome}`)
  console.log(`[db] id: ${plano.id}   ← use este valor em PLANO_AUTOCADASTRO_ID`)
  console.log(`[db] limite de usuários: ${limiteUsuario}`)

  const margem = (valorParceiro: number, meses: number) =>
    (PRECO_REVENDA_MENSAL * meses - valorParceiro).toFixed(2)

  console.log('\nMargem do parceiro (revenda a R$ 89,90/mês ao cliente final):')
  console.log(`  Mensal      paga  59.90  vende   89.90  →  ganha R$ ${margem(59.90, 1)}`)
  console.log(`  Trimestral  paga 171.90  vende  269.70  →  ganha R$ ${margem(171.90, 3)}`)
  console.log(`  Anual       paga 679.90  vende 1078.80  →  ganha R$ ${margem(679.90, 12)}`)
}

main()
  .catch((e) => { console.error('\nErro:', e instanceof Error ? e.message : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
