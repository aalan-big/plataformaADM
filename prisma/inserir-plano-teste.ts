/**
 * Grava/atualiza o "Plano Teste" no banco com os Price IDs de TESTE já criados no Stripe.
 * NÃO chama o Stripe — só o banco. Idempotente (pode rodar de novo sem duplicar nada).
 *
 * Rodar (depois de reativar o Supabase):
 *   npx dotenv -e apps/server/.env -- tsx prisma/inserir-plano-teste.ts
 */
import { prisma, findPlanoByNome, criarPlano, updatePlano } from '@startbig/database'

const NOME_PLANO = 'Plano Teste'

const dados = {
  nome:                    NOME_PLANO,
  limiteUsuario:           1,
  precoMensal:             49.90,
  precoTrimestral:         142.90,
  precoAnual:              565.90,
  stripePriceIdMensal:     'price_1TrhpXFuTAGh0hX5fCH6r5Tu',
  stripePriceIdTrimestral: 'price_1TrhpYFuTAGh0hX5aJhy8L80',
  stripePriceIdAnual:      'price_1TrhpYFuTAGh0hX50evjBher',
}

async function main() {
  const existente = await findPlanoByNome(NOME_PLANO)
  const plano = existente
    ? await updatePlano(existente.id, dados)
    : await criarPlano(dados)

  console.log(`[db] Plano ${existente ? 'ATUALIZADO' : 'CRIADO'}: ${plano.nome} (id ${plano.id})`)
  console.log('\n✅ Pronto. Agora no /debug: crie um cliente + uma licença nesse plano e gere a cobrança.')
}

main()
  .catch((e) => { console.error('❌ Erro:', e instanceof Error ? e.message : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
