/**
 * ============================================================================
 * NOME DO ARQUIVO: limpar-backups-para-cadeia.ts
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Zera o inventário de backups E os objetos correspondentes no R2, para que o
 * modelo novo (ciclo semanal: FULL + FRAGMENTO) comece consistente.
 *
 * POR QUE ELE PRECISA EXISTIR:
 * O deploy roda `prisma db push`, e o schema novo é incompatível com as linhas
 * antigas em três pontos:
 *
 *   1. o enum TipoBackup deixou de ter BANCO/IMAGENS/OS — não existe conversão
 *      automática de 'BANCO' para 'FULL' ou 'FRAGMENTO';
 *   2. `ciclo` é NOT NULL sem default, e as linhas antigas têm `periodo` NULL;
 *   3. `periodo` era 'AAAA-MM' e `ciclo` é 'AAAA-MM-DD' — semânticas diferentes,
 *      não é renomear coluna.
 *
 * Com a tabela cheia, o `db push` falha ou exige --accept-data-loss. Rodar isto
 * ANTES do deploy é o que torna a subida previsível.
 *
 * E POR QUE ELE TAMBÉM APAGA NO R2:
 * Limpar só o banco deixaria os objetos órfãos no bucket: sem linha no
 * inventário, nenhuma rotina volta a olhar para eles, e eles ficam sendo pagos
 * para sempre. Inventário e bucket saem daqui zerados juntos, ou nenhum dos dois.
 *
 * COMO RODAR (na VPS, onde estão o banco e o .env de produção):
 *   npx tsx scripts/limpar-backups-para-cadeia.ts            # simulação
 *   npx tsx scripts/limpar-backups-para-cadeia.ts --executar # apaga de verdade
 * ============================================================================
 */
import * as dotenv from 'dotenv'
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: './apps/server/.env' })

const prisma   = new PrismaClient()
const executar = process.argv.includes('--executar')
const marca    = executar ? '' : '[SIMULAÇÃO] '

function s3(): S3Client {
  const endpointCustomizado = Boolean(process.env.BACKUP_S3_ENDPOINT)

  return new S3Client({
    region:   process.env.BACKUP_S3_REGION || 'auto',
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.BACKUP_S3_PATH_STYLE
      ? process.env.BACKUP_S3_PATH_STYLE === 'true'
      : endpointCustomizado,
    credentials: {
      accessKeyId:     process.env.BACKUP_S3_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY as string,
    },
  })
}

/// Apaga tudo sob um prefixo, em lotes de 1000 (limite do DeleteObjects).
async function limparPrefixo(cliente: S3Client, bucket: string, prefixo: string): Promise<number> {
  let apagados = 0
  let token: string | undefined

  do {
    const lista = await cliente.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefixo, ContinuationToken: token,
    }))

    const chaves = (lista.Contents ?? []).map(o => ({ Key: o.Key as string })).filter(o => o.Key)

    if (chaves.length > 0) {
      if (executar)
        await cliente.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chaves } }))
      apagados += chaves.length
    }

    token = lista.IsTruncated ? lista.NextContinuationToken : undefined
  } while (token)

  return apagados
}

async function main() {
  const bucket = process.env.BACKUP_S3_BUCKET

  if (!bucket || !process.env.BACKUP_S3_ACCESS_KEY_ID) {
    console.error('✖ Credenciais do R2 ausentes. Rode este script NA VPS, onde está o .env de produção.')
    process.exit(1)
  }

  console.log(`${marca}bucket: ${bucket}`)

  // Levanta os prefixos a partir do INVENTÁRIO, não do bucket: só se apaga o que
  // este sistema registrou ter escrito. Prefixo que não tem linha no banco não é
  // desta aplicação, e sair varrendo bucket por conta própria é como se apagam
  // dados de outro sistema por engano.
  const linhas = await prisma.backup.findMany({
    distinct: ['licencaId'],
    select:   { clienteId: true, licencaId: true },
  })

  const total = await prisma.backup.count()

  if (total === 0) {
    console.log('✔ Inventário já está vazio. Nada a fazer — pode rodar o deploy.')
    return
  }

  console.log(`${marca}${total} linha(s) de backup em ${linhas.length} licença(s).`)

  const cliente = s3()
  let objetos   = 0

  for (const l of linhas) {
    const prefixo = `clientes/${l.clienteId}/${l.licencaId}/`
    const n       = await limparPrefixo(cliente, bucket, prefixo)
    objetos += n
    console.log(`${marca}  ${prefixo} → ${n} objeto(s)`)
  }

  if (executar) {
    const { count } = await prisma.backup.deleteMany({})
    console.log(`\n✔ ${objetos} objeto(s) apagados do R2 e ${count} linha(s) do inventário.`)
    console.log('  Pode rodar o deploy: o `db push` agora aplica o schema novo sem conflito.')
  } else {
    console.log(`\n${marca}apagaria ${objetos} objeto(s) do R2 e ${total} linha(s) do inventário.`)
    console.log('  Rode de novo com --executar para valer.')
  }
}

main()
  .catch(e => { console.error('✖ Falhou:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
