/**
 * ============================================================================
 * SCRIPT: conferir o estado real de uma cobrança PIX no Asaas
 * ============================================================================
 * PARA QUE SERVE:
 * Quando o banco do cliente diz que o PIX "não está mais disponível para pagar",
 * a resposta está no Asaas, não no nosso banco. As duas visões podem divergir:
 * a nossa linha diz PENDENTE e válida até amanhã, enquanto lá a cobrança já
 * venceu, foi cancelada, ou o QR expirou antes do nosso `expiraEm`.
 *
 * Compara as duas lado a lado e diz qual delas está mentindo.
 *
 * SÓ LEITURA. Não cria, não cancela, não altera nada.
 *
 * COMO RODAR (na VPS, na raiz do projeto):
 *
 *   npx dotenv -e apps/server/.env -- tsx scripts/checar-pix-asaas.ts
 *
 * Para olhar uma cobrança específica:
 *   COBRANCA_ID=<uuid> npx dotenv -e apps/server/.env -- tsx scripts/checar-pix-asaas.ts
 * ============================================================================
 */
import { prisma } from '@startbig/database'

const chave = process.env.ASAAS_API_KEY?.trim() ?? ''
const ehProducao = chave.startsWith('$aact_prod_')
const baseUrl = process.env.ASAAS_BASE_URL?.trim()
  ?? (ehProducao ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3')

async function asaas<T>(caminho: string): Promise<T | { erro: string }> {
  try {
    const res = await fetch(`${baseUrl}${caminho}`, {
      headers: { access_token: chave, 'Content-Type': 'application/json' },
    })
    const corpo = await res.json().catch(() => null)
    if (!res.ok) return { erro: `HTTP ${res.status} — ${JSON.stringify(corpo)?.slice(0, 200)}` }
    return corpo as T
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) }
  }
}

async function main() {
  if (!chave) { console.log('ASAAS_API_KEY ausente no .env — PIX não está configurado.'); return }

  console.log(`Ambiente do Asaas: ${ehProducao ? 'PRODUÇÃO (cobra de verdade)' : '*** SANDBOX ***'}`)
  console.log(`Base URL: ${baseUrl}`)
  if (!ehProducao) {
    console.log('\n>>> ATENÇÃO: chave de SANDBOX. QR de sandbox NÃO é pagável em banco real —')
    console.log('>>> é exatamente o sintoma de "não disponível para pagar".\n')
  }

  const id = process.env.COBRANCA_ID?.trim()
  const cobrancas = id
    ? await prisma.cobrancaRenovacao.findMany({ where: { id } })
    : await prisma.cobrancaRenovacao.findMany({
        where:   { metodo: 'PIX' },
        orderBy: { criadoEm: 'desc' },
        take:    5,
      })

  if (cobrancas.length === 0) { console.log('Nenhuma cobrança PIX encontrada.'); return }

  const agora = new Date()

  for (const c of cobrancas) {
    console.log('\n' + '─'.repeat(72))
    console.log(`NOSSA LINHA  ${c.id}`)
    console.log(`  criada em     ${c.criadoEm.toISOString()}`)
    console.log(`  status        ${c.status}`)
    console.log(`  valor         R$ ${c.valor}`)
    console.log(`  expiraEm      ${c.expiraEm?.toISOString() ?? '(sem prazo)'}${c.expiraEm && c.expiraEm < agora ? '   <-- JÁ PASSOU' : ''}`)
    console.log(`  temCopiaECola ${c.copiaECola ? 'sim' : 'NÃO'}`)
    console.log(`  idNoGateway   ${c.gatewayCobrancaId ?? '(NUNCA CHEGOU AO ASAAS)'}`)

    if (!c.gatewayCobrancaId) {
      console.log('  >>> Linha órfã: existe aqui e não existe no Asaas. Nada para pagar.')
      continue
    }

    const pag: any = await asaas(`/payments/${c.gatewayCobrancaId}`)
    if (pag?.erro) { console.log(`\nNO ASAAS     ERRO: ${pag.erro}`); continue }

    console.log(`\nNO ASAAS`)
    console.log(`  status        ${pag.status}`)
    console.log(`  valor         R$ ${pag.value}`)
    console.log(`  vencimento    ${pag.dueDate}`)
    console.log(`  deletada      ${pag.deleted ? 'SIM' : 'não'}`)

    const qr: any = await asaas(`/payments/${c.gatewayCobrancaId}/pixQrCode`)
    if (qr?.erro) {
      console.log(`  QR            ERRO: ${qr.erro}`)
    } else {
      const exp = qr.expirationDate ? new Date(qr.expirationDate) : null
      console.log(`  QR expira em  ${qr.expirationDate ?? '(não informado)'}${exp && exp < agora ? '   <-- QR MORTO' : ''}`)
      if (exp && c.expiraEm && exp < c.expiraEm) {
        console.log('  >>> DIVERGÊNCIA: o QR do Asaas morre ANTES do nosso expiraEm.')
        console.log('  >>> A idempotência devolve esta cobrança como válida e o banco recusa.')
      }
    }

    // Diagnóstico final
    const pagavel = pag.status === 'PENDING' && !pag.deleted
    console.log(`\n  VEREDITO: ${pagavel ? 'deveria ser pagável' : `NÃO pagável — status ${pag.status}${pag.deleted ? ' (deletada)' : ''}`}`)
  }
}

main()
  .catch(err => { console.error('Falhou:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
