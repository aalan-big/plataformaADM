/**
 * ============================================================================
 * SCRIPT: censo das fichas fiscais (SÓ LEITURA)
 * ============================================================================
 * PARA QUE SERVE:
 * Antes de mudar qualquer regra do fiscal (plano de refatoração, F0.2), saber
 * como está cada cliente que emite ou vai emitir: ambiente, token, id da Focus,
 * certificado, CSC, última nota autorizada e rejeições recentes.
 *
 * NÃO ESCREVE NADA. Só `findMany`. Não fala com a Focus.
 *
 * NÃO MOSTRA SEGREDO: do token sai só "sim/não". CNPJ e razão social aparecem
 * porque são o que o suporte precisa para achar o cliente — não compartilhe a
 * saída fora da equipe.
 *
 * COMO RODAR (na VPS, na pasta do projeto):
 *   npm run fiscal:censo
 * ============================================================================
 */
import { prisma } from '@startbig/database'

const DIA = 24 * 60 * 60 * 1000
const AMBIENTE = (a: number) => (a === 1 ? 'PRODUÇÃO' : 'homologação')

function diasAte(data: Date | null): string {
  if (!data) return '—'
  const dias = Math.floor((data.getTime() - Date.now()) / DIA)
  return dias < 0 ? `VENCIDO há ${-dias}d` : `${dias}d`
}

function quando(data: Date | null | undefined): string {
  return data ? data.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

async function main() {
  const fichas = await prisma.empresaFiscalConfig.findMany({ orderBy: { criadoEm: 'asc' } })
  const seteDiasAtras = new Date(Date.now() - 7 * DIA)

  console.log(`\nCenso fiscal — ${fichas.length} ficha(s) — ${new Date().toISOString()}\n`)

  const resumo = { producao: 0, homologacao: 0, semToken: 0, semEmpresaFocus: 0, certificadoRuim: 0, semNotaAutorizada: 0 }

  for (const f of fichas) {
    const licencas = await prisma.licenca.findMany({
      where:  { clienteId: f.clienteId },
      select: { id: true, status: true },
    })
    const ids = licencas.map(l => l.id)

    const ultimaAutorizada = ids.length
      ? await prisma.emissaoLog.findFirst({
          where:   { licencaId: { in: ids }, acao: 'EMISSAO', resultado: 'autorizado' },
          orderBy: { criadoEm: 'desc' },
          select:  { criadoEm: true, ambiente: true, tipoDocumento: true },
        })
      : null

    const recusas = ids.length
      ? await prisma.emissaoLog.findMany({
          where:   { licencaId: { in: ids }, acao: 'EMISSAO', resultado: { not: 'autorizado' }, criadoEm: { gte: seteDiasAtras } },
          orderBy: { criadoEm: 'desc' },
          select:  { mensagem: true },
        })
      : []

    // O cStat está no começo da mensagem da SEFAZ só às vezes; contar pelo
    // texto "Rejeição: ..." já basta para o suporte enxergar o padrão.
    const motivos = new Map<string, number>()
    for (const r of recusas) {
      const motivo = (r.mensagem ?? 'sem mensagem').replace(/\[.*$/, '').slice(0, 70).trim()
      motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1)
    }

    const alertas: string[] = []
    if (f.ambiente !== 1) alertas.push('em homologação')
    if (!f.focusEmpresaToken) alertas.push('SEM TOKEN (não emite)')
    if (!f.focusEmpresaId) alertas.push('sem id da Focus (certificado/CSC vão procurar pelo CNPJ)')
    if (f.certificadoStatus !== 'ATIVO') alertas.push(`certificado ${f.certificadoStatus}`)
    if (f.certificadoVencimento && f.certificadoVencimento.getTime() - Date.now() < 30 * DIA) alertas.push('certificado vence em < 30 dias')
    if (!ultimaAutorizada) alertas.push('nenhuma nota autorizada ainda')

    f.ambiente === 1 ? resumo.producao++ : resumo.homologacao++
    if (!f.focusEmpresaToken) resumo.semToken++
    if (!f.focusEmpresaId) resumo.semEmpresaFocus++
    if (f.certificadoStatus !== 'ATIVO') resumo.certificadoRuim++
    if (!ultimaAutorizada) resumo.semNotaAutorizada++

    console.log(`■ ${f.razaoSocial}  (CNPJ ${f.cnpj})  cliente ${f.clienteId}`)
    console.log(`  ambiente ${AMBIENTE(f.ambiente)} | token ${f.focusEmpresaToken ? 'sim' : 'NÃO'} | id Focus ${f.focusEmpresaId ?? '—'} | CSC ${f.cscConfigurado ? 'sim' : 'não'}`)
    console.log(`  certificado ${f.certificadoStatus}, vence ${quando(f.certificadoVencimento)} (${diasAte(f.certificadoVencimento)})`)
    console.log(`  licenças: ${licencas.map(l => `${l.id.slice(0, 8)}(${l.status})`).join(', ') || 'nenhuma'}`)
    console.log(`  última autorizada: ${ultimaAutorizada ? `${quando(ultimaAutorizada.criadoEm)} ${ultimaAutorizada.tipoDocumento} em ${AMBIENTE(ultimaAutorizada.ambiente)}` : '—'}`)
    if (motivos.size) {
      console.log(`  recusas nos últimos 7 dias: ${recusas.length}`)
      for (const [m, n] of motivos) console.log(`    ${n}× ${m}`)
    }
    console.log(`  ${alertas.length ? `⚠ ${alertas.join('; ')}` : '✔ completa'}\n`)
  }

  console.log('Resumo:', resumo)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
