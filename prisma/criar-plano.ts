/**
 * Cria um plano do catálogo no Stripe (produto + 3 Prices recorrentes) e cadastra/
 * atualiza o plano no banco com os Price IDs gerados.
 *
 * CATÁLOGO
 *   start     R$  89,90/mês  → cliente final que veio por PARCEIRO paga esse valor.
 *                              Os R$ 30 do parceiro são repasse por fora; o Stripe
 *                              cobra os 89,90 integrais.
 *   startbig  R$  59,90/mês  → cliente DIRETO seu paga esse valor.
 *
 * O modo (test/live) vem do prefixo da STRIPE_SECRET_KEY do .env usado. Em live o
 * script exige confirmação explícita, porque a partir daí o Price cobra de verdade.
 *
 * RODAR (teste, máquina local):
 *   PLANO=start npx dotenv -e apps/server/.env -- tsx prisma/criar-plano.ts
 *
 * RODAR (live, NA VPS, para gravar no banco de produção):
 *   PLANO=start CONFIRMAR_LIVE=sim npx dotenv -e apps/server/.env -- tsx prisma/criar-plano.ts
 *
 * Opcional: LIMITE_USUARIO=3 muda o limite de usuários do plano (padrão 1).
 *
 * É idempotente: reaproveita produto e Prices já existentes em vez de duplicar o
 * catálogo. Price no Stripe é imutável — mudar valor exige criar outro Price.
 */
import Stripe from 'stripe'
import { prisma, findPlanoByNome, criarPlano, updatePlano } from '@startbig/database'

type Preset = {
  nome:        string
  descricao:   string
  /** Preço que o cliente final paga por mês, para conferência da margem. */
  revendaMensal: number | null
  /** Valores em centavos (BRL) — é o que o Stripe cobra de quem assina. */
  precos: {
    mensal:     { valor: number; label: string; recurring: { interval: 'month' | 'year'; interval_count: number } }
    trimestral: { valor: number; label: string; recurring: { interval: 'month' | 'year'; interval_count: number } }
    anual:      { valor: number; label: string; recurring: { interval: 'month' | 'year'; interval_count: number } }
  }
}

const PRESETS: Record<string, Preset> = {
  start: {
    nome:          'Plano Start',
    descricao:     'Licença StartBig ERP — venda por parceiro (parceiro recebe R$ 30 de repasse por cliente)',
    revendaMensal: null,
    precos: {
      mensal:     { valor:   8990, label: 'Mensal',     recurring: { interval: 'month', interval_count: 1 } },
      trimestral: { valor:  25790, label: 'Trimestral', recurring: { interval: 'month', interval_count: 3 } },
      anual:      { valor: 101990, label: 'Anual',      recurring: { interval: 'year',  interval_count: 1 } },
    },
  },
  startbig: {
    nome:          'Plano StartBIG',
    descricao:     'Licença StartBig ERP — venda direta',
    revendaMensal: null,
    precos: {
      mensal:     { valor:  5990, label: 'Mensal',     recurring: { interval: 'month', interval_count: 1 } },
      trimestral: { valor: 17190, label: 'Trimestral', recurring: { interval: 'month', interval_count: 3 } },
      anual:      { valor: 67990, label: 'Anual',      recurring: { interval: 'year',  interval_count: 1 } },
    },
  },
}

/** Acha um produto ativo pelo nome exato, para não duplicar o catálogo a cada execução. */
async function acharProduto(stripe: Stripe, nome: string) {
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.name === nome) return p
  }
  return null
}

/** Acha um Price ativo do produto com exatamente o mesmo valor e periodicidade. */
async function acharPrice(
  stripe: Stripe,
  produtoId: string,
  valor: number,
  rec: { interval: 'month' | 'year'; interval_count: number },
) {
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
  const chave = (process.env.PLANO ?? '').trim().toLowerCase()
  const preset = PRESETS[chave]
  if (!preset)
    throw new Error(`Defina PLANO com um destes: ${Object.keys(PRESETS).join(' | ')}. Recebido: "${chave || '(vazio)'}"`)

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY não configurada no .env usado.')

  // Cobre chave secreta (sk_) e restrita (rk_): as duas existem em test e em live,
  // e classificar uma rk_live como test faria o script criar Price que cobra de
  // verdade sem pedir a confirmação explícita.
  const ehLive = /^(sk|rk)_live_/.test(key)
  console.log(`Plano: ${preset.nome}`)
  console.log(`Modo:  ${ehLive ? 'LIVE — dinheiro real' : 'TEST'}\n`)

  if (ehLive && process.env.CONFIRMAR_LIVE !== 'sim')
    throw new Error(
      'ABORTADO: chave sk_live detectada. Em live este script cria Prices que cobram de verdade.\n' +
      '   Se é isso mesmo que você quer, rode de novo com CONFIRMAR_LIVE=sim.',
    )

  const stripe = new Stripe(key)
  const limiteUsuario = Number(process.env.LIMITE_USUARIO ?? 1) || 1

  const produto =
    (await acharProduto(stripe, preset.nome)) ??
    (await stripe.products.create({ name: preset.nome, description: preset.descricao }))
  console.log(`[stripe] produto ${produto.id} (${produto.name})`)

  const priceIds: Record<string, string> = {}

  for (const [chavePreco, cfg] of Object.entries(preset.precos)) {
    const existente = await acharPrice(stripe, produto.id, cfg.valor, cfg.recurring)
    const price = existente ?? (await stripe.prices.create({
      product:     produto.id,
      currency:    'brl',
      unit_amount: cfg.valor,
      recurring:   cfg.recurring,
    }))
    priceIds[chavePreco] = price.id
    console.log(`[stripe] ${cfg.label.padEnd(11)} → ${price.id}  R$ ${(cfg.valor / 100).toFixed(2)}  ${existente ? '(reaproveitado)' : '(criado)'}`)
  }

  const dados = {
    nome:                    preset.nome,
    limiteUsuario,
    precoMensal:             preset.precos.mensal.valor     / 100,
    precoTrimestral:         preset.precos.trimestral.valor / 100,
    precoAnual:              preset.precos.anual.valor      / 100,
    stripePriceIdMensal:     priceIds.mensal,
    stripePriceIdTrimestral: priceIds.trimestral,
    stripePriceIdAnual:      priceIds.anual,
  }

  const jaExiste = await findPlanoByNome(preset.nome)
  const plano = jaExiste ? await updatePlano(jaExiste.id, dados) : await criarPlano(dados)

  console.log(`\n[db] Plano ${jaExiste ? 'ATUALIZADO' : 'CRIADO'}: ${plano.nome}`)
  console.log(`[db] id: ${plano.id}`)
  console.log(`[db] limite de usuários: ${limiteUsuario}`)
}

main()
  .catch((e) => { console.error('\nErro:', e instanceof Error ? e.message : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
