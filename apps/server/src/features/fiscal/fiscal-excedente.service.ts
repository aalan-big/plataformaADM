import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { prisma } from '@startbig/database'
import { StripeService, METADATA_EXCEDENTE_FISCAL } from '../../common/stripe/stripe.service'
import { EmailService } from '../../core/email/email.service'
import { AMBIENTE_PRODUCAO, competenciaAtual } from './fiscal-comum'
import { FRANQUIA_NOTAS, PRECO_EXCEDENTE, FRANQUIA_VALE_DESDE } from './fiscal-franquia.service'

/** "2026-12" → "2026-11"; "2027-01" → "2026-12". */
export function competenciaAnterior(competencia = competenciaAtual()): string {
  const [ano, mes] = competencia.split('-').map(Number)
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`
}

export type FechamentoLicenca = {
  licencaId:  string
  emitidas:   number
  franquia:   number
  excedentes: number
  valor:      number
  status:     string
  erro?:      string | null
}

/**
 * Fecha o mês: cobra no cartão as notas acima da franquia.
 *
 * Roda no dia 1º, às 8h de Brasília, sobre o mês que acabou. Pode rodar de novo
 * sem cobrar duas vezes — a fatura é uma por (licença, competência), gravada
 * antes de falar com o Stripe. Uma linha que ficou PENDENTE (o processo caiu
 * entre gravar e cobrar) é retomada; as outras são puladas.
 *
 * O e-mail ao cliente e o registro no financeiro saem do webhook, não daqui: é
 * ele quem sabe se o cartão passou, inclusive nas retentativas dos dias seguintes.
 */
@Injectable()
export class FiscalExcedenteService {
  private readonly logger = new Logger(FiscalExcedenteService.name)

  constructor(
    private readonly stripe: StripeService,
    @Optional() private readonly email?: EmailService,
  ) {}

  @Cron('0 8 1 * *', { timeZone: 'America/Sao_Paulo' })
  async fecharMesAnterior() {
    const competencia = competenciaAnterior()
    const r = await this.fecharMes(competencia)
    this.logger.log(`[excedente] ${competencia} fechado: ${r.length} licença(s) acima da franquia.`)
  }

  async fecharMes(competencia: string, opcoes: { simular?: boolean } = {}): Promise<FechamentoLicenca[]> {
    if (competencia < FRANQUIA_VALE_DESDE) return []

    const linhas = await prisma.consumoFiscal.findMany({
      where:  { competencia, ambiente: AMBIENTE_PRODUCAO },
      select: { licencaId: true, emitidas: true, cotaExtra: true },
    })
    const porLicenca = new Map<string, { emitidas: number; extras: number }>()
    for (const l of linhas) {
      const t = porLicenca.get(l.licencaId) ?? { emitidas: 0, extras: 0 }
      t.emitidas += l.emitidas
      t.extras   += l.cotaExtra
      porLicenca.set(l.licencaId, t)
    }

    const resultado: FechamentoLicenca[] = []
    for (const [licencaId, t] of porLicenca) {
      const franquia   = FRANQUIA_NOTAS + t.extras
      const excedentes = t.emitidas - franquia
      if (excedentes <= 0) continue

      const valor = excedentes * PRECO_EXCEDENTE
      const base  = { licencaId, emitidas: t.emitidas, franquia, excedentes, valor }

      const existente = await prisma.faturaExcedenteFiscal.findUnique({
        where: { licencaId_competencia: { licencaId, competencia } },
      })
      if (existente && existente.status !== 'PENDENTE') {
        resultado.push({ ...base, status: existente.status })
        continue
      }
      if (opcoes.simular) {
        resultado.push({ ...base, status: 'SIMULADO' })
        continue
      }

      resultado.push(await this.cobrar(competencia, base, existente?.id))
    }
    return resultado
  }

  private async cobrar(
    competencia: string,
    base: Omit<FechamentoLicenca, 'status'>,
    idExistente?: string,
  ): Promise<FechamentoLicenca> {
    const { licencaId, emitidas, franquia, excedentes, valor } = base
    const fatura = idExistente
      ? { id: idExistente }
      : await prisma.faturaExcedenteFiscal.create({
          data: { licencaId, competencia, emitidas, franquia, excedentes, valor, status: 'PENDENTE' },
        })

    const licenca = await prisma.licenca.findUnique({ where: { id: licencaId }, select: { stripeSubscriptionId: true } })

    // Cliente de PIX só passa da franquia com nota avulsa do admin, e aí a
    // avulsa já está na franquia. Chegar aqui é exceção: fica para cobrar à mão.
    if (!licenca?.stripeSubscriptionId) {
      await prisma.faturaExcedenteFiscal.update({ where: { id: fatura.id }, data: { status: 'SEM_CARTAO' } })
      await this.alertar(licencaId, competencia, valor, 'Licença acima da franquia sem cartão no Stripe — cobrar à mão.')
      return { ...base, status: 'SEM_CARTAO' }
    }

    try {
      const r = await this.stripe.cobrarAvulsoNaAssinatura({
        subscriptionId: licenca.stripeSubscriptionId,
        valor,
        descricao: `Notas fiscais acima da franquia — ${competencia} (${excedentes} × R$ ${PRECO_EXCEDENTE})`,
        metadata:  { tipo: METADATA_EXCEDENTE_FISCAL, licencaId, competencia },
        chave:     `excedente-${licencaId}-${competencia}`,
      })
      // Recusa fica COBRANDO, não FALHOU: quem passa para FALHOU é o webhook,
      // e é nessa passagem que o cliente recebe o aviso.
      const status = r.pago ? 'PAGA' : 'COBRANDO'
      await prisma.faturaExcedenteFiscal.update({
        where: { id: fatura.id },
        data:  { stripeInvoiceId: r.invoiceId, erro: r.erro },
      })
      // O webhook pode ter chegado antes e já marcado PAGA: não rebaixa.
      await prisma.faturaExcedenteFiscal.updateMany({
        where: { id: fatura.id, status: 'PENDENTE' },
        data:  { status },
      })
      return { ...base, status, erro: r.erro }
    } catch (err) {
      // Nem a fatura saiu. Fica PENDENTE: o próximo fechamento retoma.
      const erro = err instanceof Error ? err.message : String(err)
      await prisma.faturaExcedenteFiscal.update({ where: { id: fatura.id }, data: { erro } })
      await this.alertar(licencaId, competencia, valor, `Stripe recusou criar a fatura: ${erro}`)
      return { ...base, status: 'PENDENTE', erro }
    }
  }

  private async alertar(licencaId: string, competencia: string, valor: number, motivo: string) {
    this.logger.warn(`[excedente] ${licencaId} ${competencia}: ${motivo}`)
    try {
      await this.email?.enviarAlertaOperacional({
        titulo:     'Excedente de notas não cobrado',
        subtitulo:  `Notas acima da franquia em ${competencia}.`,
        evento:     'fiscal.excedente',
        motivo,
        referencia: licencaId,
        valor,
        acao:       'Ver em Clientes → perfil → Cota fiscal do mês. Linha PENDENTE é retomada no próximo fechamento (POST /fiscal/excedentes/fechar).',
      })
    } catch (err) {
      this.logger.warn(`[excedente] alerta não enviado: ${err instanceof Error ? err.message : err}`)
    }
  }
}
