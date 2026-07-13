/**
 * Imprime o licencaId a partir do e-mail do cliente OU da chave de ativação.
 * RODAR na VPS:
 *   CLIENTE_EMAIL="bigtec07@gmail.com" npx dotenv -e apps/server/.env -- tsx scripts/pegar-licenca-id.ts
 *   CHAVE="START-25CBE80A"            npx dotenv -e apps/server/.env -- tsx scripts/pegar-licenca-id.ts
 */
import { prisma } from '@startbig/database'

async function main() {
  const email = process.env.CLIENTE_EMAIL?.trim()
  const chave = process.env.CHAVE?.trim()
  if (!email && !chave) throw new Error('Defina CLIENTE_EMAIL ou CHAVE.')

  const licencas = await prisma.licenca.findMany({
    where: chave ? { chaveAtivacao: chave } : { cliente: { email } },
    include: { cliente: { select: { email: true } }, plano: { select: { nome: true } } },
    orderBy: { criadoEm: 'desc' },
  })

  if (licencas.length === 0) { console.log('Nenhuma licença encontrada.'); return }
  for (const l of licencas) {
    console.log(`licencaId: ${l.id} | chave: ${l.chaveAtivacao} | plano: ${l.plano.nome} | status: ${l.status} | cliente: ${l.cliente.email}`)
  }
}
main().catch(e => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
