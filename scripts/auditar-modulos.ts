/**
 * ============================================================================
 * SCRIPT: auditar quem já recebe lista preenchida na claim `modulos`
 * ============================================================================
 * PARA QUE SERVE:
 * É o pré-voo obrigatório antes de semear qualquer módulo novo.
 *
 * A claim `modulos` do JWT é ALLOWLIST COMPLETA do lado do ERP: lista vazia
 * significa "a plataforma ainda não configurou" e libera tudo; lista preenchida
 * libera SÓ o que está nela. Não é incremento.
 *
 * A consequência é contraintuitiva: conceder UM módulo a uma licença tira dela
 * todos os outros. Uma cortesia de NFE dada no painel deixa a claim em ['NFE'],
 * e a partir da revalidação seguinte aquela loja perde o financeiro inteiro —
 * sem ninguém ter mexido em financeiro.
 *
 * E não é lento: o ERP relê a claim a cada requisição, e o token é reescrito na
 * revalidação online, que roda no boot e a cada poucos minutos de navegação.
 * Loja online sente em minutos. Os 7 dias de validade do JWT são o teto de quem
 * está offline — não são rede de segurança para desfazer engano.
 *
 * Este script responde duas perguntas, nas DUAS origens que alimentam a claim
 * (olhar só os planos esconde exatamente o caso silencioso acima):
 *
 *   1. Quais planos já vinculam módulos — atinge todas as licenças do plano.
 *   2. Quais licenças têm concessão avulsa ou cortesia vigente — uma a uma.
 *
 * COMO RODAR (na raiz do projeto):
 *
 *   npx dotenv -e apps/server/.env -- tsx scripts/auditar-modulos.ts
 * ============================================================================
 */
import { prisma, modulosDaLicenca, modulosBase } from '@startbig/database'

async function main() {
  console.log('Auditoria da claim `modulos` — quem já está em modo allowlist\n')

  const base = await modulosBase()
  console.log(base.length > 0
    ? `Módulos-base (entram em TODA licença): ${base.join(', ')}\n`
    : 'Módulos-base: nenhum ainda.\n')

  // ── 1. Vínculos por plano ────────────────────────────────────────────────
  const vinculos = await prisma.planoModulo.findMany({
    include: { plano: { select: { nome: true } }, modulo: true },
    orderBy: { plano: { nome: 'asc' } },
  })

  console.log('── Vínculos por PLANO ' + '─'.repeat(45))
  if (vinculos.length === 0) {
    console.log('  (nenhum — todo plano ainda entrega lista vazia por esta via)')
  } else {
    for (const v of vinculos) {
      const inativo = v.modulo.ativo ? '' : '  [INATIVO — não entra na claim]'
      const cota    = v.cotaMensal == null ? 'sem teto' : `cota ${v.cotaMensal}`
      console.log(`  ${v.plano.nome} → ${v.modulo.identificador} (${cota})${inativo}`)
    }
  }

  // ── 2. Concessões avulsas e cortesias vigentes ───────────────────────────
  const agora = new Date()
  const extras = await prisma.licencaModuloExtra.findMany({
    where:   { OR: [{ dataVencimento: null }, { dataVencimento: { gt: agora } }] },
    include: {
      modulo:  true,
      licenca: {
        select: {
          id: true, chaveAtivacao: true,
          plano:   { select: { nome: true } },
          cliente: { select: { email: true, pf: { select: { nomeCompleto: true } }, pj: { select: { razaoSocial: true } } } },
        },
      },
    },
  })

  console.log('\n── Concessões AVULSAS / CORTESIAS vigentes ' + '─'.repeat(24))
  if (extras.length === 0) {
    console.log('  (nenhuma — nenhuma licença individual foi puxada para allowlist por esta via)')
  } else {
    for (const e of extras) {
      const c    = e.licenca.cliente
      const nome = c.pf?.nomeCompleto ?? c.pj?.razaoSocial ?? c.email
      const ate  = e.dataVencimento ? ` até ${e.dataVencimento.toLocaleDateString('pt-BR')}` : ' sem prazo'
      const tipo = e.cortesia ? 'cortesia' : 'contratado'
      console.log(`  ${nome} (${e.licenca.plano?.nome ?? '?'}) → ${e.modulo.identificador} [${tipo}${ate}]`)
    }
  }

  // ── 3. O veredito: a claim real de cada licença ativa ────────────────────
  //
  // As duas listas acima dizem "onde há vínculo". Esta diz o que o ERP vai
  // realmente receber — que é a única pergunta que importa, porque é a união
  // das origens e é ela que decide o que fecha.
  const licencas = await prisma.licenca.findMany({
    where:  { status: { in: ['ATIVA', 'AGUARDANDO'] } },
    select: {
      chaveAtivacao: true,
      plano:   { select: { nome: true, modulos: { select: { modulo: { select: { identificador: true, ativo: true } } } } } },
      cliente: { select: { email: true, pf: { select: { nomeCompleto: true } }, pj: { select: { razaoSocial: true } } } },
      modulosExtras: { select: { dataVencimento: true, modulo: { select: { identificador: true, ativo: true } } } },
    },
  })

  console.log('\n── Claim resultante por licença ativa ' + '─'.repeat(29))
  let vazias = 0
  const preenchidas: string[] = []
  for (const l of licencas) {
    const claim = modulosDaLicenca(l, base)
    if (claim.length === 0) { vazias++; continue }
    const c    = l.cliente
    const nome = c.pf?.nomeCompleto ?? c.pj?.razaoSocial ?? c.email
    preenchidas.push(`  ${nome} (${l.plano?.nome ?? '?'}) → [${claim.join(', ')}]`)
  }

  console.log(`  ${vazias} licença(s) com claim VAZIA — o ERP abre inteiro (estado de hoje).`)
  if (preenchidas.length > 0) {
    console.log(`  ${preenchidas.length} licença(s) com claim PREENCHIDA — o ERP libera SÓ o que está na lista:\n`)
    preenchidas.forEach(l => console.log(l))
    console.log('\n  ⚠ Confira cada uma: falta algum módulo que essa loja usa hoje?')
  }

  // -- 4. Quem esta em qual plano ------------------------------------------
  //
  // Esta e a pergunta que decide o alcance do seed, e a secao 3 nao responde:
  // quando a claim esta vazia ela so conta as licencas. Depois do seed toda
  // licenca recebe os modulos-base (seguro) e perde tudo que o plano dela nao
  // inclui — entao "quem esta em qual plano" e, literalmente, a lista de quem
  // mantem e de quem perde cada recurso.
  const porPlano = new Map<string, string[]>()
  for (const l of licencas) {
    const cli  = l.cliente
    const nome = cli.pf?.nomeCompleto ?? cli.pj?.razaoSocial ?? cli.email
    const pl   = l.plano?.nome ?? '(sem plano)'
    porPlano.set(pl, [...(porPlano.get(pl) ?? []), nome])
  }

  console.log('')
  console.log('-- Licencas ativas por PLANO ' + '-'.repeat(37))
  const planosCadastrados = await prisma.plano.findMany({
    select: { nome: true, status: true }, orderBy: { precoMensal: 'asc' },
  })
  for (const pl of planosCadastrados) {
    const clientes = porPlano.get(pl.nome) ?? []
    const vinculados = await prisma.planoModulo.findMany({
      where:   { plano: { nome: pl.nome } },
      include: { modulo: { select: { identificador: true } } },
    })
    const mods = vinculados.map(v => v.modulo.identificador).join(', ') || 'nenhum'
    console.log(`  ${pl.nome}${pl.status === 'ATIVO' ? '' : ' [' + pl.status + ']'} - ${clientes.length} licenca(s) ativa(s) | modulos do plano: ${mods}`)
    clientes.forEach(c => console.log(`      . ${c}`))
  }
  const semPlano = porPlano.get('(sem plano)') ?? []
  if (semPlano.length > 0) console.log(`  (sem plano) - ${semPlano.length} licenca(s)`)

  console.log('\nConcluído.')
}

main()
  .catch(err => { console.error('Falhou:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
