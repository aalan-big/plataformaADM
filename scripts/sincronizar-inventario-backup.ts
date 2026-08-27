/**
 * ============================================================================
 * SCRIPT: alinhar o inventário de backups com o que existe no bucket
 * ============================================================================
 * PARA QUE SERVE:
 * Quando o bucket é trocado (ou objetos somem por qualquer motivo), o inventário
 * continua dizendo CONFIRMADO para arquivos que não existem mais. Isso não é só
 * um número errado num relatório — tem duas consequências silenciosas:
 *
 *   1. O `/status` responde ao ERP que o full do ciclo já foi enviado, então o
 *      ERP NÃO reenvia. O cliente fica sem backup restaurável até a virada do
 *      ciclo, e ninguém fica sabendo.
 *   2. A rotação trava: ela exige o full do ciclo corrente no bucket para
 *      autorizar limpar os ciclos velhos. Ela aborta (o que está certo), mas
 *      nunca mais avança enquanto o inventário mentir.
 *
 * Marcar como FALHOU resolve os dois: o ERP volta a enviar, e a rotação volta a
 * ter um full de verdade para conferir.
 *
 * NÃO apaga linha nenhuma. O histórico fica, com o motivo registrado — saber que
 * existiu um backup que se perdeu vale mais que uma tabela limpa.
 *
 * COMO RODAR (na VPS, na raiz do projeto):
 *
 *   # ver o que faria, sem gravar:
 *   SIMULAR=1 npx dotenv -e apps/server/.env -- tsx scripts/sincronizar-inventario-backup.ts
 *
 *   # aplicar:
 *   npx dotenv -e apps/server/.env -- tsx scripts/sincronizar-inventario-backup.ts
 * ============================================================================
 */
import { prisma, marcarBackupFalhou } from '@startbig/database'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'

const SIMULAR = process.env.SIMULAR === '1'
const MOTIVO  = process.env.MOTIVO?.trim() || 'Objeto ausente no bucket (troca de bucket em 26/08/2026).'

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
  try {
    await s3!.send(new HeadObjectCommand({ Bucket: bucket!, Key: chave }))
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!s3) { console.log('R2 não configurado no .env — nada a fazer.'); return }

  const marca = SIMULAR ? '[SIMULAÇÃO] ' : ''
  console.log(`${marca}Bucket: ${bucket}\n`)

  const linhas = await prisma.backup.findMany({
    where:   { status: 'CONFIRMADO' },
    orderBy: [{ licencaId: 'asc' }, { ciclo: 'asc' }, { sequencia: 'asc' }],
    select:  { id: true, licencaId: true, ciclo: true, sequencia: true, tipo: true, chaveS3: true },
  })

  if (linhas.length === 0) { console.log('Nenhum backup CONFIRMADO no inventário.'); return }

  const ausentes: typeof linhas = []
  for (const l of linhas) {
    if (!(await existe(l.chaveS3))) ausentes.push(l)
  }

  console.log(`${linhas.length} elo(s) conferido(s), ${ausentes.length} ausente(s) no bucket.\n`)

  if (ausentes.length === 0) { console.log('Inventário já bate com a nuvem. Nada a fazer.'); return }

  /**
   * Trava de segurança: se TUDO sumiu, a hipótese mais provável não é perda de
   * arquivo — é bucket ou prefixo errado no .env. Marcar tudo como falha nesse
   * caso destruiria um inventário correto por causa de uma variável trocada.
   */
  if (ausentes.length === linhas.length) {
    console.log('>>> TODOS os elos estão ausentes. Isso quase certamente é bucket ou')
    console.log('>>> prefixo errado, não perda de arquivo. NADA foi alterado.')
    console.log('>>> Confira BACKUP_S3_BUCKET e BACKUP_S3_ENDPOINT antes de rodar de novo.')
    console.log('>>> Se a perda for real mesmo, rode com FORCAR=1.')
    if (process.env.FORCAR !== '1') return
    console.log('\n>>> FORCAR=1 — seguindo mesmo assim.\n')
  }

  for (const a of ausentes) {
    console.log(`  ${a.licencaId}  ${a.ciclo}#${a.sequencia} ${a.tipo}`)
    // Usa a função do repositório, não um update solto: ela é o único lugar que
    // sabe qual campo guarda o motivo, e é a mesma que o cron usa.
    if (!SIMULAR) await marcarBackupFalhou(a.id, MOTIVO)
  }

  console.log(`\n${marca}${ausentes.length} linha(s) ${SIMULAR ? 'seriam marcadas' : 'marcadas'} como FALHOU.`)
  if (!SIMULAR) {
    console.log('\nO ERP volta a enviar o full no próximo contato — os clientes ficam com')
    console.log('backup restaurável de novo sem você precisar avisar ninguém.')
  }
}

main()
  .catch(err => { console.error('Falhou:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
