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
  deletarBackupsDaLicenca,
  marcarBackupFalhou,
  podarEventosDeBackup,
} from '@startbig/database'
import { EmailService } from '../../core/email/email.service'
import { StorageService } from '../../common/storage/storage.service'

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

    // 3. Fechar uploads de backup que ficaram pendurados
    await this.fecharBackupsPendurados()

    // 4. Retenção dos backups na nuvem
    await this.aplicarRetencaoDeBackups()

    this.logger.log('Rotinas diárias concluídas.')
  }

  /**
   * URL emitida que nunca confirmou. Depois do TTL da URL (10 min) não há mais
   * como o upload acontecer, então a linha vira FALHOU — senão ela conta para
   * sempre no limite diário e trava o cliente no dia seguinte.
   */
  private async fecharBackupsPendurados() {
    try {
      const pendurados = await findBackupsPendentesExpirados(60)
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
   * Apaga da nuvem o backup de quem não tem licença ativa há mais de 90 dias.
   *
   * Isso NÃO pode ser uma lifecycle rule do bucket: a nuvem não sabe quem está
   * pagando, ela só enxerga idade e prefixo. Uma regra por idade seria pior que
   * inútil — apagaria o backup de um cliente ativo cujo PC ficou dois meses
   * desligado, que é justamente quem mais precisa dele quando voltar.
   */
  private async aplicarRetencaoDeBackups() {
    if (!this.storage.configurado) return

    try {
      const mortos = await findBackupsDeLicencasMortas(this.RETENCAO_BACKUP_DIAS)

      for (const m of mortos) {
        const prefixo  = `clientes/${m.clienteId}/${m.licencaId}/`
        const removidos = await this.storage.removerPrefixo(prefixo)
        await deletarBackupsDaLicenca(m.licencaId)
        this.logger.log(
          `[backup] retenção: ${removidos} objeto(s) removido(s) de ${prefixo} ` +
          `(licença ${m.licenca.status}, último backup em ${m.emitidoEm.toISOString().slice(0, 10)}).`,
        )
      }

      const podados = await podarEventosDeBackup(this.RETENCAO_EVENTOS_DIAS)
      if (podados.count > 0)
        this.logger.log(`[backup] ${podados.count} evento(s) antigo(s) podado(s) do histórico.`)
    } catch (err) {
      this.logger.error('Erro ao aplicar retenção de backups:', err)
    }
  }
}
