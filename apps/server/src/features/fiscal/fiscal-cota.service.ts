import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { prisma, concederNotasExtras, resolverCotaModulo, MODULO_NFE } from '@startbig/database'
import { AMBIENTE_PRODUCAO, competenciaAtual, nomeAmbiente, buscarEmpresaConfig } from './fiscal-comum'

/**
 * Cota fiscal: consumo do mês por documento, notas avulsas concedidas pelo
 * admin e o contador que a emissão incrementa.
 */
@Injectable()
export class FiscalCotaService {
  private readonly logger = new Logger(FiscalCotaService.name)


  /**
   * Soma 1 ao contador do mês.
   *
   * O `increment` do Postgres resolve a corrida: dois caixas do mesmo cliente
   * emitindo ao mesmo tempo somam 2, não 1. Também é best-effort, e a falha aqui
   * erra para BAIXO de propósito — deixar de contar uma nota é preferível a
   * bloquear um cliente que pagou por causa de uma escrita nossa que falhou.
   */
  async incrementarConsumo(
    licencaId: string,
    ambiente: number,
    tipoDocumento: string,
    campo: 'emitidas' | 'canceladas',
  ) {
    const competencia = competenciaAtual()
    try {
      await prisma.consumoFiscal.upsert({
        where:  { licencaId_competencia_ambiente_tipoDocumento: { licencaId, competencia, ambiente, tipoDocumento } },
        update: { [campo]: { increment: 1 } },
        create: { licencaId, competencia, ambiente, tipoDocumento, [campo]: 1 },
      })
    } catch (err) {
      this.logger.error(`Falha ao contabilizar ${campo} de ${tipoDocumento} da licença ${licencaId} em ${competencia}: ${err instanceof Error ? err.message : err}`)
    }
  }

  /**
   * Consumo e teto do mês corrente para uma licença, POR TIPO DE DOCUMENTO.
   *
   * O tipo é obrigatório na conta porque cada documento é um módulo com cota
   * própria: sem separar, uma NFC-e emitida consumiria a cota da NF-e, e o
   * cliente seria bloqueado num documento por causa do uso de outro.
   *
   * Só produção entra. `cota: null` significa ilimitado — o estado de todo plano
   * até alguém preencher o campo.
   *
   * Devolve também o AMBIENTE vigente, porque quem decide isso é a configuração
   * do cliente e o ERP não teria como saber: uma tela dizendo "Homologação"
   * enquanto a plataforma emite em produção é pior do que não ter tela.
   * `configurado: false` é resposta, não erro — cliente sem config fiscal ainda
   * precisa conseguir abrir a tela para descobrir o que falta.
   */
  async consumoMensal(
    licencaId: string,
    tipoDocumento: string = MODULO_NFE,
    /**
     * A config já carregada por quem chamou. A emissão a busca antes de tudo, e
     * sem este parâmetro o caminho quente da nota faria a mesma consulta duas
     * vezes só para preencher um campo informativo.
     */
    configConhecida?: { ambiente: number } | null,
  ) {
    const competencia = competenciaAtual()

    /**
     * `buscarEmpresaConfig` já confere se a licença existe. Quando a config vem
     * pronta, quem chamou passou por lá — repetir a checagem aqui seria uma
     * consulta a mais no caminho de cada nota para reconfirmar o que acabou de
     * ser confirmado.
     */
    const config = configConhecida !== undefined
      ? configConhecida
      : await buscarEmpresaConfig(licencaId)

    const consumo = await prisma.consumoFiscal.findUnique({
      where: { licencaId_competencia_ambiente_tipoDocumento: { licencaId, competencia, ambiente: AMBIENTE_PRODUCAO, tipoDocumento } },
    })

    /**
     * A cota vem do vínculo licença↔módulo, e o identificador do módulo é o
     * MESMO valor do tipo de documento — por isso a busca aqui é direta.
     * Enquanto o catálogo não estiver configurado não existe vínculo, `null`
     * volta, e ninguém é bloqueado por uma cota que nunca foi definida.
     */
    const cotaPlano = await resolverCotaModulo(licencaId, tipoDocumento)
    const cotaExtra = consumo?.cotaExtra ?? 0
    const emitidas  = consumo?.emitidas ?? 0

    // Plano ilimitado ignora o extra: somar avulsas a "sem teto" não significa
    // nada, e mostrar um número aqui daria a impressão errada de que há limite.
    const cota = cotaPlano === null ? null : cotaPlano + cotaExtra

    return {
      tipoDocumento,
      competencia,
      emitidas,
      canceladas: consumo?.canceladas ?? 0,
      cotaPlano,
      cotaExtra,
      cota,
      restantes:  cota === null ? null : Math.max(0, cota - emitidas),
      ilimitado:  cota === null,
      configurado:  !!config,
      ambiente:     config?.ambiente ?? null,
      ambienteNome: config ? nomeAmbiente(config.ambiente) : null,
    }
  }

  /**
   * Concede notas avulsas para o mês corrente.
   *
   * É a saída manual enquanto a venda de pacote não existe: cliente estourou a
   * cota no dia 20, o admin libera o que faltava e a emissão volta na hora — sem
   * precisar trocar o plano dele nem mexer no teto de todo mundo que usa aquele
   * plano. Some na virada do mês, junto com a linha da competência.
   */
  async concederExtras(licencaId: string, quantidade: number, motivo?: string, tipoDocumento: string = MODULO_NFE) {
    const licenca = await prisma.licenca.findUnique({ where: { id: licencaId }, select: { id: true } })
    if (!licenca) throw new NotFoundException({
      codigo:   'LICENCA_NAO_ENCONTRADA',
      mensagem: 'Licença não encontrada.',
    })

    await concederNotasExtras(licencaId, quantidade, tipoDocumento)
    this.logger.log(`[fiscal] ${quantidade} nota(s) avulsa(s) concedida(s) à licença ${licencaId}${motivo ? ` — ${motivo}` : ''}.`)

    return this.consumoMensal(licencaId, tipoDocumento)
  }
}
