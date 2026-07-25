/**
 * Valida no BANCO a estrutura de parceiros e comissões — Fase 1 do módulo.
 *
 * Rodar DEPOIS do `npx prisma db push`, e de preferência NA VPS, que é onde
 * mora o banco de produção.
 *
 *   npx dotenv -e apps/server/.env -- tsx prisma/validar-parceiros.ts
 *
 * O que ele faz:
 *   1. Confere que as tabelas existem e responde quantas linhas há em cada uma.
 *   2. Avisa se `parceiros` já tem linhas — importante porque `codigo` é UNIQUE
 *      NOT NULL, e uma tabela com linhas antigas impediria o db push.
 *   3. Exercita o caminho completo (parceiro → cliente vinculado → comissão)
 *      DENTRO DE UMA TRANSAÇÃO QUE SEMPRE É REVERTIDA. Nada fica gravado:
 *      o script termina lançando um erro de propósito para o Postgres desfazer
 *      tudo. É a forma de testar escrita em produção sem sujar produção.
 *   4. Testa a trava de idempotência: duas comissões para o mesmo pagamento
 *      têm de ser recusadas pelo índice único.
 *
 * Se qualquer passo falhar, o script sai com código 1 e diz o que quebrou.
 */
import { prisma } from '@startbig/database'

/** Sentinela usada para forçar o rollback — não é falha de verdade. */
const ROLLBACK = 'ROLLBACK_PROPOSITAL'

const ok    = (m: string) => console.log(`  OK    ${m}`)
const falha = (m: string) => { console.log(`  FALHA ${m}`); process.exitCode = 1 }
const nota  = (m: string) => console.log(`  nota  ${m}`)

async function main() {
  console.log('\n=== 1. Estrutura ===')

  const [parceiros, comissoes, clientes, pagamentos] = await Promise.all([
    prisma.parceiro.count(),
    prisma.comissaoParceiro.count(),
    prisma.cliente.count(),
    prisma.pagamento.count(),
  ])

  ok(`tabela parceiros responde — ${parceiros} linha(s)`)
  ok(`tabela comissoes_parceiro responde — ${comissoes} linha(s)`)
  nota(`base atual: ${clientes} cliente(s), ${pagamentos} pagamento(s)`)

  if (parceiros > 0)
    nota('parceiros já tem linhas: confira se todas ganharam um `codigo` válido no db push.')

  console.log('\n=== 2. Escrita (em transação revertida) ===')

  const cliente   = await prisma.cliente.findFirst({ select: { id: true, email: true } })
  const pagamento = await prisma.pagamento.findFirst({
    where:   { comissao: null },
    select:  { id: true, valor: true, meses: true, clienteId: true, licencaId: true },
    orderBy: { criadoEm: 'desc' },
  })

  if (!cliente) {
    nota('nenhum cliente no banco — teste de escrita pulado.')
    return
  }

  const sufixo = Date.now().toString(36).toUpperCase().slice(-6)

  try {
    await prisma.$transaction(async (tx) => {
      const parceiro = await tx.parceiro.create({
        data: {
          codigo:            `TESTE${sufixo}`,
          nomeParceiro:      'Parceiro de Validação (rollback)',
          status:            'ATIVO',
          tipoComissao:      'FIXO_MENSAL',
          valorComissaoFixa: 30,
        },
      })
      ok(`parceiro criado com codigo ${parceiro.codigo}`)

      await tx.cliente.update({ where: { id: cliente.id }, data: { parceiroId: parceiro.id } })
      ok(`cliente ${cliente.email} vinculado ao parceiro`)

      if (!pagamento) {
        nota('nenhum pagamento sem comissão disponível — parte de comissão pulada.')
        throw new Error(ROLLBACK)
      }

      const meses = pagamento.meses ?? 1
      const valor = 30 * meses

      const comissao = await tx.comissaoParceiro.create({
        data: {
          parceiroId:   parceiro.id,
          clienteId:    pagamento.clienteId,
          licencaId:    pagamento.licencaId,
          pagamentoId:  pagamento.id,
          competencia:  new Date().toISOString().slice(0, 7),
          valorBase:    pagamento.valor,
          meses,
          tipoComissao: 'FIXO_MENSAL',
          parametro:    30,
          valor,
        },
      })
      ok(`comissão criada: R$ ${valor.toFixed(2)} (${meses} mês(es) x R$ 30) sobre pagamento de R$ ${Number(pagamento.valor).toFixed(2)}`)

      const lido = await tx.comissaoParceiro.findUnique({
        where:   { id: comissao.id },
        include: { parceiro: true, cliente: { select: { email: true } }, pagamento: { select: { gateway: true } } },
      })

      if (lido?.parceiro?.codigo === parceiro.codigo && lido.status === 'PENDENTE')
        ok('leitura com joins (parceiro + cliente + pagamento) funcionando, status inicial PENDENTE')
      else
        falha('leitura com joins devolveu dados inesperados')

      const porParceiro = await tx.comissaoParceiro.groupBy({
        by:     ['status'],
        where:  { parceiroId: parceiro.id },
        _sum:   { valor: true },
        _count: { _all: true },
      })
      ok(`agregação por status funcionando — ${porParceiro.map(g => `${g.status}: ${g._count._all} (R$ ${Number(g._sum.valor ?? 0).toFixed(2)})`).join(', ')}`)

      // Trava de idempotência: o segundo insert no mesmo pagamento tem de falhar.
      // Isso aborta a transação no Postgres, o que não é problema — ela seria
      // revertida de qualquer forma na linha seguinte.
      try {
        await tx.comissaoParceiro.create({
          data: {
            parceiroId: parceiro.id, clienteId: pagamento.clienteId, pagamentoId: pagamento.id,
            competencia: '2000-01', valorBase: 1, meses: 1,
            tipoComissao: 'FIXO_MENSAL', parametro: 30, valor: 30,
          },
        })
        falha('índice único de pagamentoId NÃO barrou a comissão duplicada')
      } catch {
        ok('índice único barrou comissão duplicada para o mesmo pagamento')
      }

      throw new Error(ROLLBACK)
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes(ROLLBACK)) throw e
  }

  console.log('\n=== 3. Confirmação de que nada ficou gravado ===')

  const sobrou = await prisma.parceiro.count({ where: { codigo: `TESTE${sufixo}` } })
  if (sobrou === 0) ok('transação revertida — nenhum registro de teste no banco')
  else falha(`sobrou ${sobrou} parceiro de teste no banco — investigue antes de seguir`)

  const vinculo = await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { parceiroId: true } })
  if (!vinculo?.parceiroId) ok('vínculo do cliente também foi revertido')
  else nota(`cliente segue com parceiroId ${vinculo.parceiroId} — provavelmente vínculo real, não do teste`)

  console.log(
    process.exitCode === 1
      ? '\nResultado: HOUVE FALHA — veja as linhas marcadas acima.\n'
      : '\nResultado: banco validado. Pode seguir para a Fase 2.\n',
  )
}

main()
  .catch((e) => { console.error('\nErro:', e instanceof Error ? e.message : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
