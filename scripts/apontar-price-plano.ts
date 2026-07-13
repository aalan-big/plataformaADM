/**
 * Aponta um Price do Stripe num campo de preço do plano (rodar NA VPS, onde o banco responde).
 *
 * RODAR (exemplo — aponta o Price diário no campo mensal do "Plano Teste Diário"):
 *   PLANO_NOME="Plano Teste Diário" \
 *   CAMPO="mensal" \
 *   PRICE_ID="price_1TsoO8FuTAGh0hX5F65PmBmS" \
 *     npx dotenv -e apps/server/.env -- tsx scripts/apontar-price-plano.ts
 *
 * Alternativa: em vez de PLANO_NOME, use PLANO_ID="<uuid>".
 * CAMPO aceita: mensal | trimestral | anual
 */
import { prisma } from '@startbig/database'

const CAMPOS: Record<string, 'stripePriceIdMensal' | 'stripePriceIdTrimestral' | 'stripePriceIdAnual'> = {
  mensal:     'stripePriceIdMensal',
  trimestral: 'stripePriceIdTrimestral',
  anual:      'stripePriceIdAnual',
}

async function main() {
  const priceId   = process.env.PRICE_ID?.trim()
  const campoKey  = (process.env.CAMPO ?? 'mensal').trim().toLowerCase()
  const planoId   = process.env.PLANO_ID?.trim()
  const planoNome = process.env.PLANO_NOME?.trim()

  if (!priceId) throw new Error('Defina PRICE_ID com o ID do Price do Stripe.')
  const campo = CAMPOS[campoKey]
  if (!campo) throw new Error(`CAMPO inválido "${campoKey}". Use: mensal | trimestral | anual.`)
  if (!planoId && !planoNome) throw new Error('Defina PLANO_ID ou PLANO_NOME.')

  const plano = await prisma.plano.findFirst({
    where: planoId ? { id: planoId } : { nome: planoNome },
  })
  if (!plano) throw new Error(`Plano não encontrado (${planoId ?? planoNome}).`)

  const antes = (plano as any)[campo]
  await prisma.plano.update({ where: { id: plano.id }, data: { [campo]: priceId } })

  console.log(`Plano "${plano.nome}" (${plano.id})`)
  console.log(`  ${campo}: ${antes ?? '—'}  →  ${priceId}`)
  console.log('Pronto. Novas cobranças "'+campoKey+'" desse plano usarão esse Price.')
}

main()
  .catch((e) => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
