/**
 * ============================================================================
 * NOME DO ARQUIVO: cron.service.ts
 * MÓDULO: CRON
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de CRON. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  marcarLicencasVencidasBatch,
  findLicencasExpirandoOuVencidas,
  deletarSessoesInativas,
  findBackupsDeLicencasMortas,
  findBackupsPendentesExpirados,
  findCiclosSuperados,
  findBackupsConfirmadosParaVerificar,
  findFullConfirmadoDoCiclo,
  marcarBackupsRemovidos,
  cicloAtual,
  findLicencasParaAvisoDeRetencao,
  findTodosIdsDeLicenca,
  deletarBackupsDaLicenca,
  marcarBackupFalhou,
  podarEventosDeBackup,
  contarEventosAntigosDeBackup,
} from '@startbig/database'
import { EmailService } from '../../core/email/email.service'
import { StorageService, TTL_UPLOAD_SEGUNDOS } from '../../common/storage/storage.service'

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name)
  private readonly DIAS_ALERTA = [7, 3, 1]

  /// Quanto tempo o backup de um cliente sem licença ativa fica na nuvem antes de
  /// ser apagado. Também é a janela de recuperação: renovando dentro dela, o
  /// cliente volta a ter acesso ao próprio arquivo.
  private readonly RETENCAO_BACKUP_DIAS = 90
  /// Poda do diário de eventos (as linhas, não os arquivos).
  private readonly RETENCAO_EVENTOS_DIAS = 180
  /// Dias de backup parado em que se avisa o cliente — 15 e 7 dias antes de
  /// apagar. Mesmo padrão dos alertas de vencimento: casa por dia exato, então
  /// não precisa guardar "já avisei" em lugar nenhum.
  private readonly DIAS_AVISO_RETENCAO = [75, 83]

  /// Minutos até uma linha EMITIDO sem confirmação ser dada como falha.
  ///
  /// DERIVADO do TTL da URL de upload, não escrito à mão, porque a relação entre
  /// os dois é load-bearing: precisa ser sempre MAIOR que o TTL. Se alguém subir
  /// o TTL para atender uma loja com internet pior e este número ficar parado,
  /// upload lento e legítimo passa a ser marcado FALHOU enquanto ainda sobe —
  /// e o cliente perde a vaga da cota por um envio que ia dar certo.
  ///
  /// Os 30 min de folga cobrem o intervalo do próprio cron (10 min) e o atraso
  /// entre o fim do PUT e a chegada do /confirmar.
  private readonly MINUTOS_ORFA = Math.round(TTL_UPLOAD_SEGUNDOS / 60) + 30

  /// Quantos ciclos COMPLETOS guardar além do corrente.
  ///
  /// 1, e não 0, por causa do instante logo depois da limpeza: com zero, o
  /// cliente fica por um momento com um full só e nenhum fragmento, e se esse
  /// full estiver corrompido acabou — corrupção percebida no dia seguinte seria
  /// irrecuperável. Um ciclo a mais dá sempre entre 7 e 14 dias de janela.
  private readonly CICLOS_A_MANTER = 1

  constructor(
    private readonly emailService:  EmailService,
    private readonly storage:       StorageService,
  ) {}

  @Cron('*/10 * * * *') // A cada 10 minutos
  async handleGarbageCollector() {
    this.logger.debug('Executando Garbage Collector de Sessões Inativas...')
    try {
      const result = await deletarSessoesInativas(35) // 35 minutos
      if (result.count > 0) {
        this.logger.log(`[GC] ${result.count} sessão(ões) órfã(s) liberada(s) por inatividade.`)
      }
    } catch (err) {
      this.logger.error('Erro no Garbage Collector de Sessões:', err)
    }

    // Junto do GC, e não só de madrugada: enquanto o upload fica pendurado ele
    // ocupa uma vaga da cota do cliente. Esperar até 01:00 para liberar deixaria
    // quem teve uma queda de internet travado o dia inteiro.
    await this.fecharBackupsPendurados()
  }

  @Cron('0 1 * * *') // Executa todo dia às 01:00 AM
  async handleDailyJobs() {
    this.logger.log('Iniciando rotinas diárias (Cron)...')
    
    // 1. Marcar licenças vencidas
    try {
      const result = await marcarLicencasVencidasBatch()
      if (result.count > 0) {
        this.logger.log(`[Vencimento] ${result.count} licenças foram marcadas como VENCIDA.`)
      }
    } catch (err) {
      this.logger.error('Erro ao marcar licenças vencidas:', err)
    }

    // 2. Enviar alertas de inadimplência
    try {
      // Busca licenças vencendo em até 7 dias
      const maxDias = Math.max(...this.DIAS_ALERTA)
      const licencasParaAlerta = await findLicencasExpirandoOuVencidas(maxDias)
      
      const hoje = new Date()
      hoje.setHours(0, 0, 0, 0)

      for (const licenca of licencasParaAlerta) {
        if (licenca.status === 'VENCIDA' || !licenca.dataVencimento) continue
        // Assinantes com cartão no Stripe renovam automaticamente — não avisar
        if (licenca.stripeSubscriptionId) continue

        const vencimento = new Date(licenca.dataVencimento)
        vencimento.setHours(0, 0, 0, 0)

        const diffMs = vencimento.getTime() - hoje.getTime()
        const diasRestantes = Math.round(diffMs / (1000 * 60 * 60 * 24))

        if (this.DIAS_ALERTA.includes(diasRestantes)) {
          const nomeCliente = !!licenca.cliente.pf
            ? (licenca.cliente.pf?.nomeCompleto ?? licenca.cliente.email)
            : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

          await this.emailService.enviarAvisoVencimento({
            email: licenca.cliente.email,
            nomeCliente,
            diasRestantes,
            dataVencimento: licenca.dataVencimento,
          }).catch(e => {
            this.logger.warn(`Falha ao enviar alerta de vencimento para ${licenca.cliente.email}: ${e.message}`)
          })
        }
      }
    } catch (err) {
      this.logger.error('Erro ao processar alertas de vencimento:', err)
    }

    // 3. Avisar quem está prestes a perder o backup
    await this.avisarRetencaoDeBackup()

    // 4. Retenção dos backups na nuvem
    // A verificação vem ANTES de qualquer limpeza, de propósito: ela é a única
    // rotina que olha o estado real da nuvem, e queremos o retrato de antes de
    // apagar coisa nenhuma.
    await this.verificarIntegridadeDeBackups()

    // A rotação vem ANTES da retenção por licença morta: uma trabalha sobre
    // ciclos superados de cliente ativo, a outra sobre o prefixo inteiro de quem
    // não paga mais. Rodar a barata primeiro deixa menos objeto para a segunda.
    await this.rotacionarCiclosDeBackup()
    await this.aplicarRetencaoDeBackups()

    // 5. Varrer arquivos sem dono no bucket
    await this.removerBackupsOrfaos()

    this.logger.log('Rotinas diárias concluídas.')
  }

  /**
   * Avisa, 15 e 7 dias antes, quem vai perder o backup por licença inativa.
   *
   * Apagar o único backup de alguém em silêncio é indefensável — e quem está
   * nessa situação é justamente quem parou de pagar e talvez esteja tentando
   * voltar. Dois e-mails transformam "perdi tudo" em "fui avisado e tive 90 dias".
   */
  private async avisarRetencaoDeBackup() {
    try {
      for (const dias of this.DIAS_AVISO_RETENCAO) {
        const alvos = await findLicencasParaAvisoDeRetencao(dias)

        for (const a of alvos) {
          const nomeCliente = a.cliente.pf?.nomeCompleto
            ?? a.cliente.pj?.razaoSocial
            ?? a.cliente.email

          await this.emailService.enviarAvisoRetencaoBackup({
            email:         a.cliente.email,
            nomeCliente,
            diasRestantes: this.RETENCAO_BACKUP_DIAS - dias,
            ultimoBackup:  a.emitidoEm,
          }).catch(e => {
            this.logger.warn(`Falha ao avisar retenção de backup para ${a.cliente.email}: ${e.message}`)
          })
        }
      }
    } catch (err) {
      this.logger.error('Erro ao avisar sobre retenção de backup:', err)
    }
  }

  /**
   * Apaga do bucket o que não tem mais dono no banco.
   *
   * As linhas de `backups` somem em cascata quando a licença ou o cliente é
   * excluído — e a rotina de retenção trabalha a partir dessas linhas. Sem esta
   * varredura, excluir um cliente no painel deixaria o banco de dados da empresa
   * dele no bucket para sempre: você pagando por isso e guardando dado de quem
   * já saiu.
   *
   * Varre por prefixo com delimitador, então é uma chamada por cliente e não uma
   * por arquivo.
   */
  async removerBackupsOrfaos(opcoes: { simular?: boolean } = {}) {
    if (!this.storage.configurado) return
    const marca = opcoes.simular ? '[SIMULAÇÃO] ' : ''

    try {
      const idsValidos = new Set(await findTodosIdsDeLicenca())

      // Trava de segurança: banco vazio (ou consulta que falhou e devolveu nada)
      // apagaria o bucket inteiro. Nenhuma limpeza vale esse risco.
      if (idsValidos.size === 0) {
        this.logger.warn(`${marca}[backup] varredura de órfãos abortada: nenhuma licença no banco.`)
        return
      }

      const clientes = await this.storage.listarPastas('clientes/')
      let afetados = 0

      for (const clienteId of clientes) {
        const licencas = await this.storage.listarPastas(`clientes/${clienteId}/`)

        for (const licencaId of licencas) {
          const prefixo = `clientes/${clienteId}/${licencaId}/`

          if (idsValidos.has(licencaId)) {
            // Na simulação vale mostrar o que fica, não só o que sai: é olhando
            // a lista de MANTER que se percebe uma pasta legítima prestes a ser
            // apagada por engano.
            if (opcoes.simular) this.logger.log(`${marca}[backup] MANTER  ${prefixo} (licença existe)`)
            continue
          }

          const n = await this.storage.removerPrefixo(prefixo, opcoes)
          afetados += n
          this.logger.log(
            `${marca}[backup] ${opcoes.simular ? 'REMOVERIA' : 'órfão removido:'} ${prefixo} ` +
            `(${n} objeto(s)) — licença não existe mais.`,
          )
        }
      }

      if (afetados === 0) this.logger.log(`${marca}[backup] varredura de órfãos: nada a remover.`)
    } catch (err) {
      this.logger.error('Erro na varredura de backups órfãos:', err)
      throw err
    }
  }

  /**
   * URL emitida que nunca confirmou. Passado o TTL da URL não há mais como o
   * upload acontecer, então a linha vira FALHOU — senão ela conta para sempre no
   * limite diário e trava o cliente no dia seguinte.
   */
  private async fecharBackupsPendurados() {
    try {
      const pendurados = await findBackupsPendentesExpirados(this.MINUTOS_ORFA)
      for (const b of pendurados) {
        await marcarBackupFalhou(b.id, 'URL expirou sem confirmação do ERP.')
      }
      if (pendurados.length > 0)
        this.logger.log(`[backup] ${pendurados.length} upload(s) sem confirmação marcado(s) como falha.`)
    } catch (err) {
      this.logger.error('Erro ao fechar backups pendurados:', err)
    }
  }

  /**
   * Confere, objeto por objeto, se a nuvem tem o que o inventário afirma.
   *
   * No desenho antigo isso não fazia falta: o espelho subia todo dia, então um
   * objeto corrompido se curava sozinho na noite seguinte. Numa CORRENTE não —
   * o fragmento de terça sobe uma vez e fica. Se ele sumir do bucket, nada
   * reescreve aquilo, e o buraco só aparece no dia da restauração, que é o pior
   * dia possível para descobrir.
   *
   * É um HEAD por elo (operação Class B, barata) uma vez por dia. O que se ganha
   * é a diferença entre saber hoje e saber no desastre.
   */
  async verificarIntegridadeDeBackups() {
    if (!this.storage.configurado) return

    try {
      const linhas = await findBackupsConfirmadosParaVerificar()
      const faltando: string[] = []
      let divergentes = 0

      for (const l of linhas) {
        const objeto = await this.storage.conferirObjeto(l.chaveS3)

        if (!objeto) {
          faltando.push(`${l.licencaId} ${l.ciclo}#${l.sequencia} (${l.tipo})`)
          continue
        }

        // Tamanho diferente do que foi confirmado significa que o objeto foi
        // sobrescrito por fora — o inventário deixou de descrever o que está lá.
        if (l.tamanhoRealBytes !== null && objeto.tamanhoBytes !== l.tamanhoRealBytes) {
          divergentes++
          this.logger.warn(
            `[backup] tamanho divergente — ${l.chaveS3}: inventário ${l.tamanhoRealBytes}, ` +
            `bucket ${objeto.tamanhoBytes}.`,
          )
        }
      }

      if (faltando.length === 0 && divergentes === 0) {
        this.logger.log(`[backup] verificação: ${linhas.length} elo(s) conferido(s), tudo íntegro.`)
        return
      }

      // Não conserta nada de propósito: um elo que sumiu não tem de onde voltar,
      // e marcar a linha como falha esconderia o problema em vez de mostrá-lo.
      // O que se quer aqui é alguém saber.
      if (faltando.length > 0)
        this.logger.error(
          `[backup] ${faltando.length} elo(s) NO INVENTÁRIO E NÃO NA NUVEM — ` +
          `a corrente desses ciclos não restaura por inteiro: ${faltando.join(' | ')}`,
        )
    } catch (err) {
      this.logger.error('Erro na verificação de integridade dos backups:', err)
    }
  }

  /**
   * Rotação de ciclo: apaga da nuvem os ciclos já superados.
   *
   * A ordem aqui é a coisa mais importante deste arquivo. Um ciclo só é elegível
   * quando existe um ciclo MAIS NOVO com FULL CONFIRMADO — confirmado no sentido
   * forte, o que passou pelo HeadObject. E mesmo assim se confere o full de novo
   * agora, antes de apagar: entre a confirmação e esta varredura passaram-se
   * dias, e a única coisa que autoriza destruir a cópia velha é a cópia nova
   * existir NESTE instante.
   *
   * Apaga por chave vinda do inventário, nunca por prefixo ou idade — no bucket
   * de backup existe conteúdo que só tem uma cópia no mundo.
   */
  async rotacionarCiclosDeBackup(opcoes: { simular?: boolean } = {}) {
    if (!this.storage.configurado) return
    const marca = opcoes.simular ? '[SIMULAÇÃO] ' : ''

    try {
      const superados = await findCiclosSuperados(this.CICLOS_A_MANTER)

      if (superados.length === 0) {
        this.logger.log(`${marca}[backup] rotação: nenhum ciclo superado.`)
        return
      }

      for (const s of superados) {
        // Reconfere o full que autoriza esta limpeza. Se ele sumiu do bucket, o
        // ciclo velho é a única cópia que resta e não se toca nele.
        const fullAtual = await findFullConfirmadoDoCiclo(s.licencaId, cicloAtual())

        if (!fullAtual || !(await this.storage.conferirObjeto(fullAtual.chaveS3))) {
          this.logger.warn(
            `${marca}[backup] rotação abortada em ${s.licencaId}: o full do ciclo corrente ` +
            `não está no bucket. O ciclo ${s.ciclo} fica.`,
          )
          continue
        }

        if (!opcoes.simular) {
          await this.storage.removerChaves(s.chaves)
          await marcarBackupsRemovidos(s.ids)
        }

        this.logger.log(
          `${marca}[backup] ciclo ${s.ciclo} da licença ${s.licencaId} removido ` +
          `(${s.chaves.length} objeto(s)).`,
        )
      }
    } catch (err) {
      this.logger.error('Erro na rotação de ciclos de backup:', err)
    }
  }

  /**
   * Apaga da nuvem o backup de quem não tem licença ativa há mais de 90 dias.
   *
   * Isso NÃO pode ser uma lifecycle rule do bucket: a nuvem não sabe quem está
   * pagando, ela só enxerga idade e prefixo. Uma regra por idade seria pior que
   * inútil — apagaria o backup de um cliente ativo cujo PC ficou dois meses
   * desligado, que é justamente quem mais precisa dele quando voltar.
   */
  async aplicarRetencaoDeBackups(opcoes: { simular?: boolean } = {}) {
    if (!this.storage.configurado) return
    const marca = opcoes.simular ? '[SIMULAÇÃO] ' : ''

    try {
      const mortos = await findBackupsDeLicencasMortas(this.RETENCAO_BACKUP_DIAS)

      if (mortos.length === 0)
        this.logger.log(`${marca}[backup] retenção: nenhuma licença elegível.`)

      for (const m of mortos) {
        const prefixo   = `clientes/${m.clienteId}/${m.licencaId}/`
        const afetados  = await this.storage.removerPrefixo(prefixo, opcoes)
        if (!opcoes.simular) await deletarBackupsDaLicenca(m.licencaId)

        this.logger.log(
          `${marca}[backup] retenção: ${afetados} objeto(s) ${opcoes.simular ? 'seriam removidos' : 'removido(s)'} ` +
          `de ${prefixo} (licença ${m.licenca.status}, último backup em ${m.emitidoEm.toISOString().slice(0, 10)}).`,
        )
      }

      if (opcoes.simular) {
        const antigos = await contarEventosAntigosDeBackup(this.RETENCAO_EVENTOS_DIAS)
        this.logger.log(`${marca}[backup] poda de histórico: ${antigos} evento(s) seriam removidos.`)
      } else {
        const podados = await podarEventosDeBackup(this.RETENCAO_EVENTOS_DIAS)
        if (podados.count > 0)
          this.logger.log(`[backup] ${podados.count} evento(s) antigo(s) podado(s) do histórico.`)
      }
    } catch (err) {
      this.logger.error('Erro ao aplicar retenção de backups:', err)
      throw err
    }
  }
}
