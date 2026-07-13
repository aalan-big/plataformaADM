/**
 * ============================================================================
 * SCRIPT PONTUAL: definir/gravar senha de um cliente existente
 * ============================================================================
 * PARA QUE SERVE:
 * Clientes cadastrados ANTES da senha virar obrigatória no auto-cadastro ficaram
 * com `senhaHash` vazio e não conseguem usar /erp/auth/login ("Senha não
 * configurada"). Este script grava a senha direto no banco, com hash bcrypt
 * (mesmo algoritmo do sistema), para esses casos legados.
 *
 * COMO RODAR (na raiz do projeto, ex.: na VPS):
 *
 *   CLIENTE_EMAIL="aalanallvesgt@gmail.com" CLIENTE_SENHA="SuaSenhaAqui" \
 *     npx dotenv -e apps/server/.env -- tsx scripts/definir-senha-cliente.ts
 *
 * Se o cliente JÁ tiver senha e você quiser sobrescrever mesmo assim, adicione:
 *   FORCAR=1
 * ============================================================================
 */
import { prisma } from '@startbig/database'
import bcrypt from 'bcryptjs'

async function main() {
  const email  = process.env.CLIENTE_EMAIL?.trim()
  const senha  = process.env.CLIENTE_SENHA
  const forcar = process.env.FORCAR === '1'

  if (!email)  throw new Error('Defina CLIENTE_EMAIL com o e-mail do cliente.')
  if (!senha)  throw new Error('Defina CLIENTE_SENHA com a nova senha.')
  if (senha.length < 8) throw new Error('A senha deve ter no mínimo 8 caracteres.')

  const cliente = await prisma.cliente.findFirst({
    where:  { email },
    select: { id: true, email: true, senhaHash: true },
  })

  if (!cliente) {
    throw new Error(`Nenhum cliente encontrado com o e-mail "${email}".`)
  }

  if (cliente.senhaHash && !forcar) {
    console.log(`[definir-senha] Cliente ${email} JÁ possui senha configurada.`)
    console.log('[definir-senha] Para sobrescrever mesmo assim, rode novamente com FORCAR=1.')
    return
  }

  const senhaHash = await bcrypt.hash(senha, 10)

  await prisma.cliente.update({
    where: { id: cliente.id },
    data:  { senhaHash },
  })

  console.log(`[definir-senha] Senha gravada com sucesso para ${email}.`)
  console.log('[definir-senha] O cliente já pode usar POST /erp/auth/login com esse e-mail e senha.')
}

main()
  .catch((e) => {
    console.error('[definir-senha] ERRO:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
