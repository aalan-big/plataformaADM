import { Injectable, Logger, HttpException, HttpStatus, ConflictException, Optional } from '@nestjs/common'
import { createHash } from 'crypto'
import { prisma, MODULO_NFCE } from '@startbig/database'
import { EmailService } from '../../core/email/email.service'
import { AMBIENTE_PRODUCAO, competenciaAtual } from './fiscal-comum'

/**
 * Franquia mensal de notas, por empresa (licença), com todos os tipos somados:
 * NF-e + NFC-e + NFS-e de produção.
 *
 * - Até a franquia: incluso no plano.
 * - Acima dela, quem paga no CARTÃO continua emitindo e paga R$ 1 por nota, numa
 *   fatura única no dia 1º (ver `FiscalExcedenteService`). Quem paga por PIX não
 *   tem como ser cobrado sozinho, então trava na franquia.
 * - O cartão também tem um TETO: é a proteção contra o ERP emitindo em loop, que
 *   viraria uma conta surpresa no cartão do cliente.
 *
 * As notas avulsas que o admin concede somam na franquia e no teto, e não são
 * cobradas — são cortesia.
 */
export const FRANQUIA_NOTAS     = 70
export const PRECO_EXCEDENTE    = 1
export const TETO_NOTAS_CARTAO  = 300

/**
 * Primeiro mês em que a franquia vale. O deploy cai no meio de outubro, e
 * cobrar o mês corrente seria cobrar por uma regra que o cliente não conhecia
 * quando emitiu.
 */
export const FRANQUIA_VALE_DESDE = '2026-11'

/** Repetir a MESMA nota dentro desta janela é tratado como engano, não venda. */
const JANELA_DUPLICATA_MS = 60 * 60 * 1000

export type FormaCobranca = 'CARTAO' | 'PIX'

export type SituacaoFranquia = {
  competencia:     string
  vigente:         boolean
  franquia:        number
  emitidas:        number
  restantesNaFranquia: number
  excedentes:      number
  precoExcedente:  number
  valorExcedente:  number
  formaCobranca:   FormaCobranca
  /** Quantas notas o mês aceita no total. PIX: a franquia. Cartão: o teto. */
  limite:          number
  restantes:       number
}

/**
 * Campos que mudam a cada envio da mesma nota — data, número, série, ref — e por
 * isso ficam fora da assinatura. Todo o resto (itens, valores, destinatário,
 * informações adicionais com o número da venda) entra.
 */
const CAMPO_VOLATIL = (chave: string) =>
  chave.startsWith('data_') || chave === 'numero' || chave === 'serie' || chave === 'ref'

function normalizar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(normalizar)
  if (valor && typeof valor === 'object') {
    return Object.keys(valor as object)
      .filter(k => !CAMPO_VOLATIL(k))
      .sort()
      .map(k => [k, normalizar((valor as any)[k])])
  }
  return valor
}

/**
 * Hash do conteúdo da nota. Leva a licença junto para que a mesma nota de duas
 * lojas não dê o mesmo hash, e para que o hash não sirva de dicionário.
 */
export function assinaturaDaNota(licencaId: string, tipoDocumento: string, payload: unknown): string {
  return createHash('sha256')
    .update(`${licencaId}|${tipoDocumento}|${JSON.stringify(normalizar(payload))}`)
    .digest('hex')
}

/**
 * A NFC-e sem destinatário é o balcão: dois cafés iguais para dois clientes
 * anônimos em cinco minutos é venda normal, e o conteúdo da nota é idêntico.
 * Barrar ali seria travar o caixa. A NF-e e a NFS-e sempre têm destinatário.
 */
function conferePorDuplicata(tipoDocumento: string, payload: any): boolean {
  if (tipoDocumento !== MODULO_NFCE) return true
  return !!(payload?.cpf_destinatario || payload?.cnpj_destinatario)
}

@Injectable()
export class FiscalFranquiaService {
  private readonly logger = new Logger(FiscalFranquiaService.name)

  constructor(@Optional() private readonly email?: EmailService) {}

  /**
   * Cartão = tem assinatura no Stripe e nenhuma fatura de excedente em aberto.
   * Quem deixou o excedente de um mês sem pagar passa a travar na franquia como
   * o PIX: continuar emitindo seria somar dívida num cartão que já recusou.
   */
  async formaCobranca(licencaId: string): Promise<FormaCobranca> {
    const licenca = await prisma.licenca.findUnique({ where: { id: licencaId }, select: { stripeSubscriptionId: true } })
    if (!licenca?.stripeSubscriptionId) return 'PIX'
    const emAberto = await prisma.faturaExcedenteFiscal.findFirst({
      where: { licencaId, status: { in: ['COBRANDO', 'FALHOU'] } },
      select: { id: true },
    })
    return emAberto ? 'PIX' : 'CARTAO'
  }

  /** Notas de produção do mês, todos os tipos, e as avulsas concedidas. */
  async totaisDoMes(licencaId: string, competencia: string) {
    const linhas = await prisma.consumoFiscal.findMany({
      where:  { licencaId, competencia, ambiente: AMBIENTE_PRODUCAO },
      select: { emitidas: true, cotaExtra: true },
    })
    return {
      emitidas: linhas.reduce((s, l) => s + l.emitidas, 0),
      extras:   linhas.reduce((s, l) => s + l.cotaExtra, 0),
    }
  }

  async situacao(licencaId: string, competencia = competenciaAtual()): Promise<SituacaoFranquia> {
    const [{ emitidas, extras }, formaCobranca] = await Promise.all([
      this.totaisDoMes(licencaId, competencia),
      this.formaCobranca(licencaId),
    ])
    const vigente    = competencia >= FRANQUIA_VALE_DESDE
    const franquia   = FRANQUIA_NOTAS + extras
    const excedentes = Math.max(0, emitidas - franquia)
    const limite     = formaCobranca === 'CARTAO' ? TETO_NOTAS_CARTAO + extras : franquia

    return {
      competencia,
      vigente,
      franquia,
      emitidas,
      restantesNaFranquia: Math.max(0, franquia - emitidas),
      excedentes,
      precoExcedente: PRECO_EXCEDENTE,
      valorExcedente: excedentes * PRECO_EXCEDENTE,
      formaCobranca,
      limite,
      restantes: Math.max(0, limite - emitidas),
    }
  }

  /**
   * Barra a emissão de produção quando o mês já chegou no limite. Roda antes de
   * qualquer chamada à Focus, como a cota do plano.
   */
  async exigirEspaco(licencaId: string) {
    const s = await this.situacao(licencaId)
    if (!s.vigente || s.restantes > 0) return

    if (s.formaCobranca === 'PIX') {
      this.logger.warn(`Emissão barrada pela franquia: licença ${licencaId} emitiu ${s.emitidas}/${s.franquia} em ${s.competencia} (sem cartão).`)
      throw new HttpException({
        codigo:   'FRANQUIA_ESGOTADA',
        mensagem: `As ${s.franquia} notas do mês já foram usadas (${s.emitidas} emitidas). Para continuar emitindo, cadastre um cartão (R$ ${PRECO_EXCEDENTE} por nota acima da franquia) ou fale com o suporte.`,
        emitidas: s.emitidas,
        franquia: s.franquia,
      }, HttpStatus.PAYMENT_REQUIRED)
    }

    this.logger.warn(`Emissão barrada pelo teto: licença ${licencaId} emitiu ${s.emitidas}/${s.limite} em ${s.competencia}.`)
    await this.avisarUmaVez(licencaId, s.competencia, 'TETO_ATINGIDO', s)
    throw new HttpException({
      codigo:   'TETO_MENSAL_ATINGIDO',
      mensagem: `Limite de segurança de ${s.limite} notas no mês atingido (${s.emitidas} emitidas). A emissão foi pausada para proteger o seu cartão. Fale com o suporte para liberar mais.`,
      emitidas: s.emitidas,
      limite:   s.limite,
    }, HttpStatus.PAYMENT_REQUIRED)
  }

  /**
   * Barra a mesma nota mandada de novo com outra `ref` dentro de uma hora — o
   * erro que vira nota em duplicidade na SEFAZ e, acima da franquia, cobrança
   * em dobro. A mesma `ref` não passa por aqui: é a idempotência da Focus.
   *
   * `confirmado` é o operador dizendo "é outra venda, sim" (cabeçalho
   * `X-Confirmar-Duplicidade`). Devolve a assinatura para a trilha gravar.
   */
  async conferirDuplicata(
    licencaId: string,
    ambiente: number,
    tipoDocumento: string,
    ref: string,
    payload: unknown,
    confirmado = false,
  ): Promise<string> {
    const assinatura = assinaturaDaNota(licencaId, tipoDocumento, payload)
    if (confirmado || !conferePorDuplicata(tipoDocumento, payload)) return assinatura

    const anterior = await prisma.emissaoLog.findFirst({
      where: {
        licencaId,
        assinatura,
        ambiente,
        acao:      'EMISSAO',
        resultado: { in: ['autorizado', 'processando'] },
        ref:       { not: ref },
        criadoEm:  { gte: new Date(Date.now() - JANELA_DUPLICATA_MS) },
      },
      orderBy: { criadoEm: 'desc' },
      select:  { ref: true, criadoEm: true },
    })
    if (!anterior) return assinatura

    const minutos = Math.max(1, Math.round((Date.now() - anterior.criadoEm.getTime()) / 60000))
    this.logger.warn(`${tipoDocumento} ref "${ref}" barrada como duplicata de "${anterior.ref}" (${minutos} min atrás), licença ${licencaId}.`)

    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    await this.avisarUmaVez(licencaId, competenciaAtual(), `DUPLICATA:${dia}`, null, { refAnterior: anterior.ref, ref, minutos, tipoDocumento })

    throw new ConflictException({
      codigo:      'NOTA_DUPLICADA_SUSPEITA',
      mensagem:    `Esta nota é igual à ref "${anterior.ref}", autorizada há ${minutos} min. Nada foi emitido. Se for mesmo uma venda nova, confirme e envie de novo.`,
      refAnterior: anterior.ref,
    })
  }

  /**
   * Depois de uma nota de produção contada: manda os avisos de 80% da
   * franquia, franquia atingida e teto próximo, cada um uma vez no mês.
   */
  async aposEmitir(licencaId: string) {
    try {
      const s = await this.situacao(licencaId)
      if (!s.vigente) return
      if (s.emitidas >= Math.ceil(s.franquia * 0.8) && s.emitidas < s.franquia) {
        await this.avisarUmaVez(licencaId, s.competencia, 'FRANQUIA_80', s)
      }
      if (s.emitidas >= s.franquia) {
        await this.avisarUmaVez(licencaId, s.competencia, 'FRANQUIA_ATINGIDA', s)
      }
      if (s.formaCobranca === 'CARTAO' && s.emitidas >= Math.ceil(s.limite * 0.9)) {
        await this.avisarUmaVez(licencaId, s.competencia, 'TETO_PROXIMO', s)
      }
    } catch (err) {
      // Aviso é auxiliar: a nota já saiu, e o ERP precisa da resposta dela.
      this.logger.warn(`Falha ao conferir avisos de franquia da licença ${licencaId}: ${err instanceof Error ? err.message : err}`)
    }
  }

  /**
   * Grava o aviso e só então manda. Se a gravação bater na chave (já avisado),
   * não manda — é isso que segura o e-mail a uma vez por mês (por dia, na
   * duplicata) mesmo com dois caixas emitindo ao mesmo tempo.
   */
  private async avisarUmaVez(
    licencaId: string,
    competencia: string,
    tipo: string,
    s: SituacaoFranquia | null,
    duplicata?: { refAnterior: string; ref: string; minutos: number; tipoDocumento: string },
  ) {
    try {
      await prisma.avisoFiscal.create({ data: { licencaId, competencia, tipo } })
    } catch (err: any) {
      if (err?.code === 'P2002') return
      throw err
    }

    if (!this.email) return
    try {
      const licenca = await prisma.licenca.findUnique({
        where:  { id: licencaId },
        select: { cliente: { select: { email: true, pf: { select: { nomeCompleto: true } }, pj: { select: { razaoSocial: true } } } } },
      })
      const cliente = licenca?.cliente
      if (!cliente?.email) return
      const nomeCliente = cliente.pf?.nomeCompleto ?? cliente.pj?.razaoSocial ?? cliente.email

      if (duplicata) {
        await this.email.enviarAvisoDuplicata({ email: cliente.email, nomeCliente, ...duplicata })
      } else if (s) {
        await this.email.enviarAvisoFranquia({
          email: cliente.email, nomeCliente,
          tipo: tipo as 'FRANQUIA_80' | 'FRANQUIA_ATINGIDA' | 'TETO_PROXIMO' | 'TETO_ATINGIDO',
          emitidas: s.emitidas, franquia: s.franquia, limite: s.limite,
          formaCobranca: s.formaCobranca, precoExcedente: s.precoExcedente,
        })
      }
      if (tipo === 'TETO_ATINGIDO' || duplicata) {
        await this.email.enviarAlertaOperacional({
          titulo:     duplicata ? 'Nota repetida barrada' : 'Teto mensal de notas atingido',
          subtitulo:  `Cliente ${nomeCliente} (licença ${licencaId}).`,
          evento:     duplicata ? 'fiscal.duplicata' : 'fiscal.teto',
          motivo:     duplicata
            ? `${duplicata.tipoDocumento} ref "${duplicata.ref}" igual à "${duplicata.refAnterior}" de ${duplicata.minutos} min atrás.`
            : `${s?.emitidas} notas em ${competencia}; emissão pausada.`,
          referencia: licencaId,
          valor:      null,
          acao:       duplicata
            ? 'Conferir com o cliente se o ERP está reenviando vendas. Se for venda real, o operador pode confirmar e reenviar.'
            : 'Conferir com o cliente se o volume é real. Se for, liberar notas avulsas no perfil dele (Cota fiscal do mês).',
        })
      }
    } catch (err) {
      this.logger.warn(`Aviso ${tipo} da licença ${licencaId} gravado mas não enviado: ${err instanceof Error ? err.message : err}`)
    }
  }
}
