/**
 * ============================================================================
 * SCRIPT: medir o buraco entre o inventário de backups e o que está no R2
 * ============================================================================
 * PARA QUE SERVE:
 * O cron diário acusou "N elo(s) NO INVENTÁRIO E NÃO NA NUVEM". Ele diz quantos,
 * mas não quais nem de quem — e sem isso não dá para saber se é um cliente
 * perdendo tudo ou vários perdendo um pedaço.
 *
 * Este script mostra o mapa: por licença, por ciclo, o que está lá e o que não
 * está, com a chave S3 de cada ausente para conferir no painel do R2.
 *
 * A pergunta que ele responde: alguém consegue restaurar hoje?
 *
 * SÓ LEITURA. Não apaga, não marca, não conserta — um elo que sumiu não tem de
 * onde voltar, e marcar a linha como falha esconderia o problema.
 *
 * COMO RODAR (na VPS, na raiz do projeto):
 *
 *   npx dotenv -e apps/server/.env -- tsx scripts/checar-elos-backup.ts
 * ============================================================================
 */
import { prisma } from '@startbig/database'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'

const endpoint = process.env.BACKUP_S3_ENDPOINT?.trim()
const bucket   = process.env.BACKUP_S3_BUCKET?.trim()

const s3 = endpoint && bucket
  ? new S3Client({
      endpoint,
      region:      process.env.BACKUP_S3_REGION?.trim() || 'auto',
      credentials: {
        accessKeyId:     process.env.BACKUP_S3_ACCESS_KEY_ID?.trim() ?? '',
        secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY?.trim() ?? '',
      },
    })
  : null

async function existe(chave: string): Promise<boolean> {
  if (!s3) return false
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket!, Key: chave }))
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!s3) { console.log('R2 não configurado no .env — nada a conferir.'); return }
  console.log(`Bucket: ${bucket} @ ${endpoint}\n`)

  const linhas = await prisma.backup.findMany({
    where:   { status: 'CONFIRMADO' },
    orderBy: [{ licencaId: 'asc' }, { ciclo: 'asc' }, { sequencia: 'asc' }],
    select:  {
      licencaId: true, ciclo: true, sequencia: true, tipo: true,
      chaveS3: true, emitidoEm: true, tamanhoRealBytes: true,
      licenca: { select: { nomeDispositivo: true, status: true, cliente: { select: { email: true } } } },
    },
  })

  if (linhas.length === 0) { console.log('Nenhum backup CONFIRMADO no inventário.'); return }

  type Estado = { total: number; faltando: number; ciclos: Map<string, { ok: number; faltando: string[] }> }
  const porLicenca = new Map<string, Estado & { rotulo: string }>()

  for (const l of linhas) {
    const ok = await existe(l.chaveS3)

    const rotulo = `${l.licenca?.cliente?.email ?? '(sem cliente)'} — ${l.licenca?.nomeDispositivo ?? 'sem nome'}`
    if (!porLicenca.has(l.licencaId)) {
      porLicenca.set(l.licencaId, { total: 0, faltando: 0, ciclos: new Map(), rotulo })
    }
    const est = porLicenca.get(l.licencaId)!
    est.total++
    if (!est.ciclos.has(l.ciclo)) est.ciclos.set(l.ciclo, { ok: 0, faltando: [] })
    const c = est.ciclos.get(l.ciclo)!

    if (ok) c.ok++
    else { est.faltando++; c.faltando.push(`#${l.sequencia} ${l.tipo}  ${l.chaveS3}`) }
  }

  let licencasAfetadas = 0
  let totalFaltando = 0

  for (const [licencaId, est] of porLicenca) {
    totalFaltando += est.faltando
    if (est.faltando === 0) continue
    licencasAfetadas++

    console.log('─'.repeat(76))
    console.log(`LICENÇA ${licencaId}`)
    console.log(`  ${est.rotulo}`)
    console.log(`  ${est.faltando} de ${est.total} elo(s) ausentes na nuvem\n`)

    for (const [ciclo, c] of est.ciclos) {
      if (c.faltando.length === 0) {
        console.log(`  ciclo ${ciclo}: íntegro (${c.ok} elo(s))`)
        continue
      }
      /**
       * Um ciclo só restaura por inteiro: o FULL é a base e os FRAGMENTOs são
       * as diferenças em cima dele. Faltando o FULL, o ciclo inteiro morre —
       * os fragmentos sozinhos não reconstroem nada.
       */
      const perdeuFull = c.faltando.some(f => f.includes('FULL'))
      console.log(`  ciclo ${ciclo}: ${c.faltando.length} ausente(s), ${c.ok} presente(s)${perdeuFull ? '   *** SEM O FULL — CICLO IRRECUPERÁVEL ***' : ''}`)
      for (const f of c.faltando) console.log(`      ${f}`)
    }
    console.log()
  }

  console.log('═'.repeat(76))
  console.log(`RESUMO: ${totalFaltando} elo(s) ausentes, em ${licencasAfetadas} licença(s), de ${linhas.length} conferido(s).`)
  if (totalFaltando === linhas.length) {
    console.log('\n>>> TODOS sumiram. Isso não é perda de objeto — é o caminho/bucket errado.')
    console.log('>>> Confira BACKUP_S3_BUCKET e o prefixo das chaves antes de concluir qualquer coisa.')
  }
}

main()
  .catch(err => { console.error('Falhou:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
