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
import { marcarLicencasVencidasBatch, findLicencasExpirandoOuVencidas, deletarSessoesInativas } from '@startbig/database'
import { EmailService } from '../../core/email/email.service'

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name)
  private readonly DIAS_ALERTA = [7, 3, 1]

  constructor(private readonly emailService: EmailService) {}

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

    this.logger.log('Rotinas diárias concluídas.')
  }
}
