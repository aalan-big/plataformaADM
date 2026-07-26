/**
 * ============================================================================
 * NOME DO ARQUIVO: testar-backup-r2.ts
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Teste de fumaça do bucket de backup. Exercita o StorageService de verdade
 * (assinar → PUT → HeadObject → GET → apagar) contra o R2 configurado no .env.
 *
 * NÃO toca em cliente, licença nem banco de dados. Tudo acontece sob o prefixo
 * `_smoke-test/`, que não é usado por nenhum cliente, e é apagado no final.
 *
 * O teste que mais importa é o número 3: provar que um upload declarando
 * tamanho diferente do assinado é RECUSADO. É essa recusa que impede que um
 * "backup de 30 MB" chegue como 4 GB e vire fatura — se ela não funcionar, o
 * teto de 500 MB é decorativo.
 *
 * COMO RODAR (na VPS, onde as credenciais estão):
 *   npm run test:r2
 * ============================================================================
 */
import { StorageService } from '../apps/server/src/common/storage/storage.service'

const PREFIXO = '_smoke-test/'
const CHAVE   = `${PREFIXO}teste.zip`

const ok    = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`)
const falha = (m: string) => { console.log(`  \x1b[31m✘ ${m}\x1b[0m`); process.exitCode = 1 }

async function main() {
  const storage = new StorageService()

  console.log('\n=== Teste de fumaça do bucket de backup ===\n')

  if (!storage.configurado) {
    console.log('\x1b[31mBACKUP_S3_* não configuradas neste .env.\x1b[0m')
    console.log('Confira: BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY')
    process.exit(1)
  }
  ok(`credenciais lidas (bucket: ${process.env.BACKUP_S3_BUCKET})`)
  console.log(`    endpoint: ${process.env.BACKUP_S3_ENDPOINT}`)

  // Erro de configuração mais comum: o painel da Cloudflare mostra a "S3 API" do
  // bucket como https://<conta>.r2.cloudflarestorage.com/<bucket>, e o nome do
  // bucket vem colado junto no endpoint. Aí ele entra duas vezes no endereço
  // final e o R2 responde NoSuchBucket.
  const endpoint = process.env.BACKUP_S3_ENDPOINT ?? ''
  if (new URL(endpoint).pathname.replace(/\/$/, '') !== '')
    console.log(
      `\n\x1b[33m  Atenção: o endpoint tem caminho ("${new URL(endpoint).pathname}").\n` +
      `  BACKUP_S3_ENDPOINT deve terminar em .r2.cloudflarestorage.com, sem o nome\n` +
      `  do bucket — ele vai separado em BACKUP_S3_BUCKET.\x1b[0m`,
    )

  // Conteúdo determinístico para conferir byte a byte no download.
  const conteudo = Buffer.from('startbig-backup-smoke-test\n'.repeat(40), 'utf8')
  const tamanho  = conteudo.byteLength

  // ── 0. O que a credencial enxerga ─────────────────────────────────────────
  // NoSuchBucket com nome certo quase sempre é bucket em OUTRA conta ou em
  // jurisdição separada (bucket criado como "European Union" só responde no
  // endpoint <conta>.eu.r2.cloudflarestorage.com). Listar resolve a dúvida em
  // um passo. Pode ser negado se o token só tem permissão de objeto — o que
  // também é informação, não erro.
  console.log('\n0) Buckets visíveis para esta credencial')
  try {
    const nomes = await storage.listarBuckets()
    if (nomes.length === 0) console.log('    (nenhum bucket nesta conta/jurisdição)')
    else nomes.forEach(n => console.log(`    · ${n}${n === process.env.BACKUP_S3_BUCKET ? '   ← o configurado' : ''}`))

    if (nomes.length > 0 && !nomes.includes(process.env.BACKUP_S3_BUCKET ?? ''))
      console.log(
        `\n\x1b[33m  O bucket "${process.env.BACKUP_S3_BUCKET}" NÃO está nesta lista.\n` +
        `  Ou o nome difere, ou ele foi criado em outra conta, ou em jurisdição\n` +
        `  separada (aí o endpoint precisa do .eu.).\x1b[0m`,
      )
  } catch (e) {
    console.log(`    não foi possível listar (${e instanceof Error ? e.message : e})`)
    console.log('    normal se o token só tem permissão de objeto — segue o teste')
  }

  // ── 1. Assinar ────────────────────────────────────────────────────────────
  console.log('\n1) Assinar URL de upload')
  const assinado = await storage.gerarUrlUpload({ chave: CHAVE, tamanhoBytes: tamanho })
  const alvo = new URL(assinado.url)
  ok(`URL assinada para ${tamanho} bytes, expira em ${assinado.expiraEm.toISOString()}`)
  console.log(`    endereço final: ${alvo.host}${alvo.pathname}`)
  console.log(`    formato: ${alvo.host.startsWith(process.env.BACKUP_S3_BUCKET + '.') ? 'virtual-hosted (bucket no subdomínio)' : 'path-style (bucket no caminho)'}`)

  // ── 2. Upload com o tamanho CERTO ─────────────────────────────────────────
  console.log('\n2) PUT com o tamanho exato (deve ser aceito)')
  const envio = await fetch(assinado.url, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/zip', 'Content-Length': String(tamanho) },
    body:    conteudo,
  })
  if (envio.ok) ok(`upload aceito (HTTP ${envio.status})`)
  else {
    falha(`upload recusado: HTTP ${envio.status}`)
    console.log(`\n${(await envio.text()).slice(0, 600)}\n`)
    console.log('\x1b[33mSe apareceu SignatureDoesNotMatch aqui, o Content-Length assinado')
    console.log('não está sendo aceito pelo R2 e a estratégia de travar tamanho precisa mudar.\x1b[0m')
    return
  }

  // ── 3. Upload com tamanho DIFERENTE (o teste que importa) ─────────────────
  console.log('\n3) PUT declarando tamanho diferente do assinado (deve ser RECUSADO)')
  const assinado2 = await storage.gerarUrlUpload({ chave: CHAVE, tamanhoBytes: tamanho })
  const maior     = Buffer.concat([conteudo, Buffer.alloc(5000, 0x41)])
  const envio2    = await fetch(assinado2.url, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body:    maior,   // fetch declara o Content-Length real, que não bate com o assinado
  })
  if (!envio2.ok) ok(`recusado como esperado (HTTP ${envio2.status}) — o teto de tamanho é real`)
  else falha(`ACEITOU ${maior.byteLength} bytes numa URL assinada para ${tamanho}. ` +
             `O limite de tamanho NÃO está sendo imposto.`)

  // ── 4. HeadObject ─────────────────────────────────────────────────────────
  console.log('\n4) HeadObject (é o que o /confirmar usa para não confiar no cliente)')
  const info = await storage.conferirObjeto(CHAVE)
  if (info?.tamanhoBytes === tamanho) ok(`objeto encontrado com ${info.tamanhoBytes} bytes`)
  else falha(`esperado ${tamanho} bytes, encontrado: ${JSON.stringify(info)}`)

  // ── 5. Download assinado ──────────────────────────────────────────────────
  console.log('\n5) URL de download assinada')
  const dl   = await storage.gerarUrlDownload(CHAVE)
  const resp = await fetch(dl.url)
  if (!resp.ok) falha(`download recusado: HTTP ${resp.status}`)
  else {
    const baixado = Buffer.from(await resp.arrayBuffer())
    if (baixado.equals(conteudo)) ok('conteúdo baixado é idêntico ao enviado')
    else falha(`conteúdo divergente (${baixado.byteLength} vs ${tamanho} bytes)`)
  }

  // ── 6. Limpeza ────────────────────────────────────────────────────────────
  console.log('\n6) Limpeza do prefixo de teste')
  const removidos = await storage.removerPrefixo(PREFIXO)
  const sobrou    = await storage.conferirObjeto(CHAVE)
  if (removidos > 0 && sobrou === null) ok(`${removidos} objeto(s) removido(s), nada sobrou`)
  else falha(`limpeza incompleta — removidos: ${removidos}, ainda existe: ${JSON.stringify(sobrou)}`)

  console.log(
    process.exitCode === 1
      ? '\n\x1b[31mAlgum teste falhou — veja acima.\x1b[0m\n'
      : '\n\x1b[32mTodos os testes passaram. O bucket está pronto para uso.\x1b[0m\n',
  )
}

main().catch(e => {
  console.error('\n\x1b[31mErro inesperado:\x1b[0m', e)
  process.exit(1)
})
