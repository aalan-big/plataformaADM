/**
 * ============================================================================
 * SCRIPT: semear o catálogo de módulos
 * ============================================================================
 * PARA QUE SERVE:
 * É a Fase 2 do controle de acesso por módulos. Cria o catálogo de módulos.
 *
 * NÃO vincula módulo a plano: isso é decisão comercial e se faz no painel, em
 * Planos, depois que o preço estiver definido. O script só garante que o módulo
 * exista para ser marcado.
 *
 * IDEMPOTENTE: pode rodar quantas vezes quiser. Módulo existente é atualizado
 * (nome/descrição/ícone), nunca duplicado, e o `identificador` jamais muda —
 * ele viaja dentro do JWT e renomear invalidaria token em campo.
 *
 * Vínculo plano↔módulo que já exista é PRESERVADO com a cota que tiver: rodar
 * de novo não pode desfazer um teto que o admin configurou na mão.
 *
 * COMO RODAR (na raiz do projeto):
 *
 *   npx dotenv -e apps/server/.env -- tsx scripts/semear-modulos.ts
 *
 * Para ver o que faria sem gravar nada:
 *   SIMULAR=1 npx dotenv -e apps/server/.env -- tsx scripts/semear-modulos.ts
 * ============================================================================
 */
import { prisma } from '@startbig/database'

const SIMULAR = process.env.SIMULAR === '1'

/**
 * Catálogo inicial.
 *
 * REGRA: um módulo entra aqui quando o CÓDIGO dele entra — nunca antes.
 *
 * Módulo cadastrado sem implementação é uma linha que não libera nem bloqueia
 * nada, mas que na tela parece produto. Meses depois alguém olha a lista, vê o
 * nome, e anuncia para um cliente algo que não existe. Enquanto o módulo é só
 * plano futuro, o lugar dele é no roadmap, não no catálogo.
 */
/**
 * ATENÇÃO — LEIA ANTES DE ACRESCENTAR QUALQUER LINHA AQUI.
 *
 * A claim `modulos` do JWT é ALLOWLIST COMPLETA do lado do ERP: lista vazia
 * significa "a plataforma ainda não configurou" e libera tudo; lista preenchida
 * libera SÓ o que está nela. Não é incremento.
 *
 * Hoje as licenças em campo recebem `[]` e por isso o ERP abre inteiro. No
 * instante em que QUALQUER módulo passar a entrar na claim de uma licença, ela
 * cruza para o modo allowlist — e tudo que não estiver na lista fecha.
 *
 * O efeito não é lento. O ERP relê a claim a cada requisição e o token é
 * reescrito na revalidação online, que roda no boot e a cada poucos minutos de
 * navegação. Loja online sente em minutos. Os 7 dias de validade do JWT são o
 * teto de quem está offline — não são rede de segurança para desfazer engano.
 *
 * Daí a regra: um módulo que representa acesso que a base JÁ TEM entra como
 * `incluidoPorPadrao: true`, no MESMO deploy do primeiro módulo restritivo.
 * Semear só o restritivo tira da base um acesso que ninguém decidiu tirar.
 */
const CATALOGO = [
  /**
   * `vincularATodos: false` — o módulo nasce no catálogo e em NENHUM plano.
   *
   * A versão anterior vinculava a todos, para que ligar o controle não tirasse
   * acesso de quem já emitia. Isso deixou de fazer sentido: o centro fiscal
   * ainda está sendo construído e nenhum cliente emite nota hoje, então não há
   * acesso a preservar — e vincular a todos só criaria uma janela em que todo
   * plano inclui fiscal sem ninguém ter decidido isso.
   *
   * Quem entra em qual plano passa a ser escolha explícita, feita no painel,
   * depois que o preço estiver definido.
   */
  { identificador: 'NFE', nome: 'NF-e', descricao: 'Nota Fiscal Eletrônica de mercadoria, via Focus NFe.', icone: 'FileText', ordem: 10, vincularATodos: false, incluidoPorPadrao: false, vincularAosPlanos: [] },

  /**
   * FINANCEIRO — base. Visão Geral, Contas a Pagar, Contas a Receber, Extrato e
   * Plano de Contas. É o que toda loja já usa hoje.
   *
   * `incluidoPorPadrao: true` em vez de `vincularATodos: true` porque vincular
   * é um RETRATO: o loop abaixo percorre os planos que existem no instante em
   * que o script roda. O plano criado no mês seguinte nasceria sem o vínculo, e
   * toda licença dele receberia uma lista sem FINANCEIRO — cliente novo abrindo
   * o ERP com o financeiro inteiro no cadeado, sem ninguém ter mexido em nada.
   *
   * A flag não envelhece: vale inclusive para plano que ainda não existe.
   */
  { identificador: 'FINANCEIRO', nome: 'Financeiro', descricao: 'Contas a pagar e a receber, extrato e plano de contas.', icone: 'Wallet', ordem: 20, vincularATodos: false, incluidoPorPadrao: true, vincularAosPlanos: [] },

  /**
   * FINANCEIRO_PRO — o recorte que se vende. Análise, Fluxo de Caixa e
   * Conciliação. "A base guarda e controla o dinheiro; o pro avisa e aconselha."
   *
   * Vinculado a PRO e Business no próprio seed, e não depois no painel, porque
   * entre semear e vincular existe uma janela em que NINGUÉM tem o módulo — nem
   * quem paga o plano de cima. A claim vira allowlist no primeiro módulo que
   * entra, e a partir daí tudo que não está nela fecha, em minutos. Vincular no
   * mesmo comando faz semear e vender virarem um evento só.
   *
   * O plano é casado por NOME. Se ele não existir, o script aborta sem gravar
   * nada — ver o pré-voo em `main()`.
   */
  { identificador: 'FINANCEIRO_PRO', nome: 'Financeiro PRO', descricao: 'Análise, fluxo de caixa e conciliação bancária.', icone: 'ChartLine', ordem: 21, vincularATodos: false, incluidoPorPadrao: false, vincularAosPlanos: ['PRO', 'Business'] },
]

async function main() {
  const marca = SIMULAR ? '[SIMULAÇÃO] ' : ''
  console.log(`${marca}Semeando catálogo de módulos...\n`)

  /**
   * PRE-VOO: todo plano nomeado tem que existir ANTES de gravarmos qualquer
   * coisa. Abortar aqui e a diferenca entre "nada aconteceu" e uma pane.
   *
   * O motivo e a allowlist: a trava de um modulo NAO depende de ele existir no
   * catalogo, depende de a claim estar preenchida. No instante em que o primeiro
   * modulo entra, a lista deixa de ser vazia e o ERP passa a liberar so o que
   * esta nela — tudo o mais fecha. Se o plano de destino nao existir, o modulo
   * seria criado sem ter onde ser concedido, e o recurso ficaria fechado para
   * toda a base sem caminho de volta a nao ser criar o plano as pressas.
   *
   * Nesse cenario, gravar metade e pior que nao gravar nada.
   */
  const nomesDePlano = [...new Set(CATALOGO.flatMap(c => c.vincularAosPlanos))]
  const planosAlvo = new Map<string, { id: string; nome: string }>()

  if (nomesDePlano.length > 0) {
    const encontrados = await prisma.plano.findMany({
      where:  { nome: { in: nomesDePlano } },
      select: { id: true, nome: true },
    })
    encontrados.forEach(pl => planosAlvo.set(pl.nome, pl))

    const faltando = nomesDePlano.filter(n => !planosAlvo.has(n))
    if (faltando.length > 0) {
      const todos = await prisma.plano.findMany({ select: { nome: true }, orderBy: { nome: 'asc' } })
      console.error(`ABORTADO — plano nao encontrado: ${faltando.join(', ')}`)
      console.error(`Planos existentes neste banco: ${todos.map(pl => pl.nome).join(', ') || '(nenhum)'}`)
      console.error('')
      console.error('Nada foi gravado, de proposito. Semear sem o plano de destino fecharia o')
      console.error('modulo para a base inteira sem ter onde devolve-lo — a claim vira allowlist')
      console.error('no primeiro modulo que entra, e o efeito chega as lojas em minutos.')
      console.error('')
      console.error('Crie o plano no painel primeiro, ou ajuste `vincularAosPlanos` no CATALOGO.')
      process.exit(1)
    }

    for (const [nome, pl] of planosAlvo) {
      console.log(`${marca}  plano de destino confirmado: ${nome} (${pl.id})`)
    }
    console.log('')
  }

  for (const item of CATALOGO) {
    const { vincularATodos, vincularAosPlanos, ...dados } = item
    const existente = await prisma.modulo.findUnique({ where: { identificador: dados.identificador } })

    if (SIMULAR) {
      console.log(`${marca}${existente ? 'atualizaria' : 'criaria'} módulo ${dados.identificador} (${dados.nome})${dados.incluidoPorPadrao ? '  [BASE: entra na claim de toda licença]' : ''}`)
    } else {
      await prisma.modulo.upsert({
        where:  { identificador: dados.identificador },
        // `identificador` fica fora do update de propósito — é imutável.
        update: { nome: dados.nome, descricao: dados.descricao, icone: dados.icone, ordem: dados.ordem, incluidoPorPadrao: dados.incluidoPorPadrao },
        create: dados,
      })
      console.log(`  ${existente ? '~' : '+'} ${dados.identificador} — ${dados.nome}${dados.incluidoPorPadrao ? '  [BASE: entra na claim de toda licença]' : ''}`)
    }

    for (const nomePlano of vincularAosPlanos) {
      const alvo = planosAlvo.get(nomePlano)!
      const mod  = SIMULAR
        ? existente
        : await prisma.modulo.findUnique({ where: { identificador: dados.identificador } })

      const jaTem = mod
        ? await prisma.planoModulo.findUnique({
            where: { planoId_moduloId: { planoId: alvo.id, moduloId: mod.id } },
          })
        : null

      if (jaTem) {
        console.log(`      = ${alvo.nome}: ja vinculado (cota ${jaTem.cotaMensal ?? 'ilimitada'}) — preservado`)
      } else if (SIMULAR) {
        console.log(`${marca}      + ${alvo.nome}: vincularia ${dados.identificador} sem teto`)
      } else if (mod) {
        await prisma.planoModulo.create({ data: { planoId: alvo.id, moduloId: mod.id, cotaMensal: null } })
        console.log(`      + ${alvo.nome}: vinculado sem teto`)
      }
    }

    if (!vincularATodos) continue

    const modulo = SIMULAR
      ? existente
      : await prisma.modulo.findUnique({ where: { identificador: dados.identificador } })

    const planos = await prisma.plano.findMany({ select: { id: true, nome: true } })
    if (planos.length === 0) {
      console.log(`      (nenhum plano cadastrado — nada a vincular)`)
      continue
    }

    for (const plano of planos) {
      /**
       * Módulo ainda inexistente (só acontece em simulação, quando o upsert não
       * chegou a rodar) não tem vínculo para consultar. Sem este ramo a
       * simulação saía calada justamente na informação que ela existe para dar:
       * QUAIS planos passariam a incluir o módulo.
       */
      const jaTem = modulo
        ? await prisma.planoModulo.findUnique({
            where: { planoId_moduloId: { planoId: plano.id, moduloId: modulo.id } },
          })
        : null

      if (jaTem) {
        console.log(`      = ${plano.nome}: já vinculado (cota ${jaTem.cotaMensal ?? 'ilimitada'}) — preservado`)
        continue
      }
      if (SIMULAR) {
        console.log(`${marca}      + ${plano.nome}: vincularia ${dados.identificador} sem teto`)
      } else if (!modulo) {
        console.log(`      ! ${plano.nome}: módulo ${dados.identificador} não encontrado após o upsert — pulado`)
      } else {
        // Sem cota: o plano passa a ter o módulo exatamente como tinha antes de
        // existir controle nenhum. Limitar é decisão posterior, feita no painel.
        await prisma.planoModulo.create({
          data: { planoId: plano.id, moduloId: modulo.id, cotaMensal: null },
        })
        console.log(`      + ${plano.nome}: vinculado sem teto`)
      }
    }
  }

  console.log(`\n${marca}Concluído.`)
}

main()
  .catch(err => { console.error('Falhou:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
