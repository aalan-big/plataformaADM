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
  { identificador: 'NFE', nome: 'NF-e', descricao: 'Nota Fiscal Eletrônica de mercadoria, via Focus NFe.', icone: 'FileText', ordem: 10, vincularATodos: false },
]

async function main() {
  const marca = SIMULAR ? '[SIMULAÇÃO] ' : ''
  console.log(`${marca}Semeando catálogo de módulos...\n`)

  for (const item of CATALOGO) {
    const { vincularATodos, ...dados } = item
    const existente = await prisma.modulo.findUnique({ where: { identificador: dados.identificador } })

    if (SIMULAR) {
      console.log(`${marca}${existente ? 'atualizaria' : 'criaria'} módulo ${dados.identificador} (${dados.nome})`)
    } else {
      await prisma.modulo.upsert({
        where:  { identificador: dados.identificador },
        // `identificador` fica fora do update de propósito — é imutável.
        update: { nome: dados.nome, descricao: dados.descricao, icone: dados.icone, ordem: dados.ordem },
        create: dados,
      })
      console.log(`  ${existente ? '~' : '+'} ${dados.identificador} — ${dados.nome}`)
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
