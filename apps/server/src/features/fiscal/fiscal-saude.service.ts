import { Injectable, Logger, HttpException } from '@nestjs/common'
import { prisma, MODULO_NFCE } from '@startbig/database'
import { FocusNfeService } from '../../common/focus-nfe/focus-nfe.service'
import { tokenDeEmissao } from './fiscal.service'

/**
 * Painel de saúde fiscal de um cliente (F4 do plano de refatoração do fiscal).
 *
 * SÓ LEITURA, e isso é a regra do arquivo: nada aqui grava no banco nem na
 * Focus. É o que o suporte abre quando o lojista liga dizendo que a nota não
 * sai — antes da F4, a resposta saía do `npm run fiscal:censo` na VPS e de abrir
 * o painel da Focus à mão.
 *
 * Nenhum segredo sai daqui: a resposta da Focus traz os tokens e o CSC da
 * empresa, e só viram "sim/não" e datas. Quem mexer neste arquivo não pode
 * devolver o objeto da Focus inteiro "para ajudar a depurar".
 */

export type EstadoItem = 'ok' | 'atencao' | 'problema' | 'desconhecido'

export type ItemSaude = {
  chave:   string
  titulo:  string
  estado:  EstadoItem
  detalhe: string
}

export type RejeicaoAgrupada = {
  codigoSefaz: number | null
  motivo:      string
  quantidade:  number
  ultimaEm:    string
}

export type SaudeFiscal = {
  clienteId:       string
  conferidoEm:     string
  /** Pior estado entre os itens: é a cor do quadro fechado. */
  geral:           EstadoItem
  ficha:           { cnpj: string; razaoSocial: string; ambiente: number } | null
  /** `false` quando a Focus não pôde ser lida: os itens dela vêm dos dados locais ou "desconhecido". */
  focusConsultada: boolean
  temNfce:         boolean
  itens:           ItemSaude[]
  rejeicoes:       RejeicaoAgrupada[]
}

const DIA = 24 * 60 * 60 * 1000
const PRODUCAO = 1
const AVISO_VENCIMENTO_DIAS = 30
const JANELA_REJEICOES_DIAS = 7

const PESO: Record<EstadoItem, number> = { ok: 0, desconhecido: 1, atencao: 2, problema: 3 }

const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** Data e hora de Brasília: o servidor roda em UTC e o suporte lê em horário local. */
function quando(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(data)
}

function dia(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(data)
}

const nomeAmbiente = (a: number) => (a === PRODUCAO ? 'produção' : 'homologação')

/** O que se tirou da Focus, já sem segredo nenhum. */
type LeituraFocus =
  | { lida: true; empresaId: string; semIdNaFicha: boolean; cnpj: string; certificadoValidoAte: Date | null; certificadoCnpj: string | null;
      habilitaNfe: boolean; habilitaNfce: boolean; cscProducao: boolean | null; cscHomologacao: boolean | null }
  | { lida: false; item: ItemSaude }

@Injectable()
export class FiscalSaudeService {
  private readonly logger = new Logger(FiscalSaudeService.name)

  constructor(private readonly focusNfeService: FocusNfeService) {}

  async saudeDoCliente(clienteId: string, agora: Date = new Date()): Promise<SaudeFiscal> {
    const ficha = await prisma.empresaFiscalConfig.findUnique({ where: { clienteId } })
    const licencas = await prisma.licenca.findMany({
      where:  { clienteId },
      select: { id: true, planoId: true },
    })

    const base = { clienteId, conferidoEm: agora.toISOString() }

    if (!ficha) {
      const itens: ItemSaude[] = [{
        chave: 'ficha', titulo: 'Ficha fiscal', estado: 'problema',
        detalhe: 'Cliente sem ficha fiscal: não emite. Configure o CNPJ em "Configuração Fiscal" ou peça ao lojista para ativar a emissão no ERP (com NFE/NFCE na licença a ficha nasce sozinha).',
      }]
      return { ...base, geral: 'problema', ficha: null, focusConsultada: false, temNfce: false, itens, rejeicoes: [] }
    }

    const temNfce = await this.temModuloNfce(licencas)
    const focus = await this.lerFocus(ficha)
    const itens: ItemSaude[] = []

    itens.push(
      'item' in focus ? focus.item
      // Achada pelo CNPJ: funciona (certificado e CSC procuram pelo CNPJ a cada
      // envio), e a próxima ativação grava o id. Atenção, não problema.
      : focus.semIdNaFicha
        ? { chave: 'empresa', titulo: 'Empresa na Focus', estado: 'atencao',
            detalhe: `Cadastrada (id ${focus.empresaId}), CNPJ confere, mas o id não está na ficha. Funciona; a próxima ativação grava.` }
        : { chave: 'empresa', titulo: 'Empresa na Focus', estado: 'ok', detalhe: `Cadastrada (id ${focus.empresaId}), CNPJ confere.` },
    )

    itens.push(this.itemCertificado(ficha, focus, agora))
    itens.push(this.itemHabilitacao(focus, temNfce))
    itens.push(this.itemToken(ficha))
    if (temNfce) itens.push(this.itemCsc(ficha, focus))

    itens.push(ficha.ambiente === PRODUCAO
      ? { chave: 'ambiente', titulo: 'Ambiente', estado: 'ok', detalhe: 'Produção.' }
      : { chave: 'ambiente', titulo: 'Ambiente', estado: 'atencao', detalhe: 'Homologação: as notas saem sem valor fiscal. Só faz sentido em teste.' })

    const ids = licencas.map(l => l.id)
    itens.push(await this.itemUltimaNota(ids, ficha.ambiente))

    const rejeicoes = await this.rejeicoesRecentes(ids, agora)
    const totalRejeicoes = rejeicoes.reduce((s, r) => s + r.quantidade, 0)
    itens.push({
      chave: 'rejeicoes', titulo: `Rejeições (${JANELA_REJEICOES_DIAS} dias)`,
      estado: totalRejeicoes ? 'atencao' : 'ok',
      detalhe: totalRejeicoes
        ? `${totalRejeicoes} nota(s) recusada(s) pela SEFAZ. Os motivos estão logo abaixo.`
        : 'Nenhuma recusa da SEFAZ registrada.',
    })

    const geral = itens.reduce<EstadoItem>((pior, i) => (PESO[i.estado] > PESO[pior] ? i.estado : pior), 'ok')

    return {
      ...base,
      geral,
      ficha: { cnpj: ficha.cnpj, razaoSocial: ficha.razaoSocial, ambiente: ficha.ambiente },
      focusConsultada: focus.lida,
      temNfce,
      itens,
      rejeicoes,
    }
  }

  /**
   * NFC-e contratada em alguma licença do cliente, pelo plano ou como extra.
   *
   * Decide se habilitação de NFC-e e CSC entram na conferência: cobrar CSC de
   * quem só emite NF-e pintaria de vermelho um cliente que está perfeito.
   */
  private async temModuloNfce(licencas: { id: string; planoId: string | null }[]): Promise<boolean> {
    for (const l of licencas) {
      const extra = await prisma.licencaModuloExtra.findFirst({
        where:  { licencaId: l.id, modulo: { identificador: MODULO_NFCE } },
        select: { dataVencimento: true },
      })
      if (extra && (!extra.dataVencimento || extra.dataVencimento > new Date())) return true
      if (l.planoId) {
        const doPlano = await prisma.planoModulo.findFirst({
          where:  { planoId: l.planoId, modulo: { identificador: MODULO_NFCE } },
          select: { planoId: true },
        })
        if (doPlano) return true
      }
    }
    return false
  }

  /**
   * Lê o cadastro da empresa na Focus. Nunca lança: Focus fora do ar ou token
   * de parceiro ausente viram um item "desconhecido" e o resto do quadro
   * continua com os dados locais — o suporte precisa do painel justamente
   * quando alguma coisa está quebrada.
   */
  private async lerFocus(ficha: { cnpj: string; focusEmpresaId: string | null }): Promise<LeituraFocus> {
    const titulo = 'Empresa na Focus'
    const tokenDaConta = process.env.FOCUS_NFE_PARTNER_TOKEN?.trim() || process.env.FOCUS_CONTA_TOKEN?.trim()
    if (!tokenDaConta) {
      return { lida: false, item: { chave: 'empresa', titulo, estado: 'desconhecido',
        detalhe: 'Plataforma sem FOCUS_NFE_PARTNER_TOKEN no .env: não dá para conferir a Focus.' } }
    }

    try {
      let empresaId = ficha.focusEmpresaId
      let semIdNaFicha = false
      if (!empresaId) {
        const achada = await this.focusNfeService.buscarEmpresaPorCnpj(tokenDaConta, ficha.cnpj)
        if (!achada) {
          return { lida: false, item: { chave: 'empresa', titulo, estado: 'problema',
            detalhe: 'Não existe empresa com este CNPJ na Focus. O lojista precisa ativar a emissão no Centro Fiscal do ERP.' } }
        }
        empresaId = String(achada.id)
        semIdNaFicha = true
      }

      const empresa = await this.focusNfeService.consultarEmpresa(tokenDaConta, empresaId)

      if (digitos(empresa?.cnpj) !== ficha.cnpj) {
        return { lida: false, item: { chave: 'empresa', titulo, estado: 'problema',
          detalhe: `O id ${empresaId} da ficha é de OUTRO CNPJ na Focus (${digitos(empresa?.cnpj) || 'sem CNPJ'}). Corrija o id na ficha antes de qualquer envio.` } }
      }

      const validoAte = empresa?.certificado_valido_ate ? new Date(empresa.certificado_valido_ate) : null
      const leitura: LeituraFocus = {
        lida: true,
        empresaId,
        semIdNaFicha,
        cnpj: ficha.cnpj,
        certificadoValidoAte: validoAte && !Number.isNaN(validoAte.getTime()) ? validoAte : null,
        certificadoCnpj: empresa?.certificado_cnpj ? digitos(empresa.certificado_cnpj) : null,
        habilitaNfe:  empresa?.habilita_nfe === true,
        habilitaNfce: empresa?.habilita_nfce === true,
        // A Focus só devolve estes campos para quem tem permissão de vê-los;
        // ausente é "não sei", não "não tem" — aí vale o marcador da ficha.
        cscProducao:    'csc_nfce_producao'    in (empresa ?? {}) ? !!empresa.csc_nfce_producao    : null,
        cscHomologacao: 'csc_nfce_homologacao' in (empresa ?? {}) ? !!empresa.csc_nfce_homologacao : null,
      }

      return leitura
    } catch (erro) {
      const status = erro instanceof HttpException ? erro.getStatus() : 0
      this.logger.warn(`Conferência fiscal: Focus não respondeu (HTTP ${status || 'sem status'}).`)
      const detalhe =
        status === 404     ? `O id ${ficha.focusEmpresaId} da ficha não existe na Focus.`
        : [401, 403].includes(status) ? 'A Focus recusou o token de parceiro (FOCUS_NFE_PARTNER_TOKEN).'
        : `A Focus não respondeu agora (${status ? `HTTP ${status}` : 'sem resposta'}). Os itens abaixo usam os dados locais.`
      return { lida: false, item: { chave: 'empresa', titulo, estado: status === 404 ? 'problema' : 'desconhecido', detalhe } }
    }
  }

  private itemCertificado(
    ficha: { cnpj: string; certificadoStatus: string; certificadoVencimento: Date | null },
    focus: LeituraFocus,
    agora: Date,
  ): ItemSaude {
    const titulo = 'Certificado'
    const daFocus = focus.lida
    const vence = daFocus ? focus.certificadoValidoAte : ficha.certificadoVencimento
    const origem = daFocus ? '' : ' (dado local; a Focus não foi lida)'

    if (daFocus && focus.certificadoCnpj && focus.certificadoCnpj.slice(0, 8) !== ficha.cnpj.slice(0, 8)) {
      return { chave: 'certificado', titulo, estado: 'problema',
        detalhe: `O certificado na Focus é de outro CNPJ (${focus.certificadoCnpj}). A SEFAZ recusa toda nota assinada com ele.` }
    }
    if (!vence) {
      if (!daFocus && ficha.certificadoStatus === 'ATIVO') {
        return { chave: 'certificado', titulo, estado: 'desconhecido', detalhe: `Marcado como ativo, sem data de vencimento${origem}.` }
      }
      return { chave: 'certificado', titulo, estado: 'problema', detalhe: `Nenhum certificado cadastrado${origem}.` }
    }
    const dias = Math.floor((vence.getTime() - agora.getTime()) / DIA)
    if (dias < 0) {
      return { chave: 'certificado', titulo, estado: 'problema', detalhe: `VENCIDO em ${dia(vence)}${origem}. Nenhuma nota sai até o lojista enviar o novo.` }
    }
    if (dias < AVISO_VENCIMENTO_DIAS) {
      return { chave: 'certificado', titulo, estado: 'atencao', detalhe: `Vence em ${dia(vence)} (${dias} dia(s))${origem}. Avise o lojista para renovar.` }
    }
    return { chave: 'certificado', titulo, estado: 'ok', detalhe: `Válido até ${dia(vence)} (${dias} dias)${origem}.` }
  }

  private itemHabilitacao(focus: LeituraFocus, temNfce: boolean): ItemSaude {
    const titulo = 'Habilitação na Focus'
    if (!focus.lida) {
      return { chave: 'habilitacao', titulo, estado: 'desconhecido', detalhe: 'Só dá para conferir lendo a Focus.' }
    }
    const faltando = [
      !focus.habilitaNfe ? 'NF-e' : null,
      temNfce && !focus.habilitaNfce ? 'NFC-e' : null,
    ].filter(Boolean)
    if (faltando.length) {
      return { chave: 'habilitacao', titulo, estado: 'problema',
        detalhe: `${faltando.join(' e ')} desabilitada(s) na Focus: a primeira nota é recusada. Reenviar o certificado pelo ERP reabilita.` }
    }
    return { chave: 'habilitacao', titulo, estado: 'ok', detalhe: temNfce ? 'NF-e e NFC-e habilitadas.' : 'NF-e habilitada.' }
  }

  private itemToken(ficha: {
    ambiente: number; focusEmpresaToken: string | null; focusTokenProducao: string | null; focusTokenHomologacao: string | null
  }): ItemSaude {
    const titulo = 'Token de emissão'
    const ambiente = nomeAmbiente(ficha.ambiente)
    if (tokenDeEmissao(ficha)) {
      const origem = ficha.focusEmpresaToken ? 'colado na ficha' : 'gravado pela ativação, cifrado'
      return { chave: 'token', titulo, estado: 'ok', detalhe: `Presente para ${ambiente} (${origem}).` }
    }
    const cifrado = ficha.ambiente === PRODUCAO ? ficha.focusTokenProducao : ficha.focusTokenHomologacao
    if (cifrado) {
      return { chave: 'token', titulo, estado: 'problema',
        detalhe: `Há token cifrado para ${ambiente}, mas a plataforma não consegue lê-lo: FISCAL_TOKENS_KEY ausente ou trocada no .env. Não emite.` }
    }
    return { chave: 'token', titulo, estado: 'problema', detalhe: `Sem token para ${ambiente}: não emite. O lojista precisa ativar a emissão no ERP.` }
  }

  private itemCsc(ficha: { ambiente: number; cscConfigurado: boolean }, focus: LeituraFocus): ItemSaude {
    const titulo = 'CSC (NFC-e)'
    const daFocus = focus.lida ? (ficha.ambiente === PRODUCAO ? focus.cscProducao : focus.cscHomologacao) : null
    const tem = daFocus ?? ficha.cscConfigurado
    const origem = daFocus === null ? ' (marcador da ficha)' : ''
    return tem
      ? { chave: 'csc', titulo, estado: 'ok', detalhe: `Cadastrado para ${nomeAmbiente(ficha.ambiente)}${origem}.` }
      : { chave: 'csc', titulo, estado: 'problema', detalhe: `Pendente para ${nomeAmbiente(ficha.ambiente)}${origem}: o cupom sai sem QR Code válido.` }
  }

  private async itemUltimaNota(licencaIds: string[], ambienteDaFicha: number): Promise<ItemSaude> {
    const titulo = 'Última nota autorizada'
    const ultima = licencaIds.length
      ? await prisma.emissaoLog.findFirst({
          where:   { licencaId: { in: licencaIds }, acao: 'EMISSAO', resultado: 'autorizado' },
          orderBy: { criadoEm: 'desc' },
          select:  { criadoEm: true, ambiente: true, tipoDocumento: true },
        })
      : null
    if (!ultima) {
      return { chave: 'ultima_nota', titulo, estado: 'atencao',
        detalhe: 'Nenhuma registrada. (NF-e autorizada antes de 07/10/2026 pode não constar: a consulta não gravava o desfecho.)' }
    }
    const fora = ultima.ambiente !== ambienteDaFicha ? ` — em ${nomeAmbiente(ultima.ambiente)}, não no ambiente atual` : ''
    return { chave: 'ultima_nota', titulo, estado: fora ? 'atencao' : 'ok',
      detalhe: `${ultima.tipoDocumento} em ${quando(ultima.criadoEm)}${fora}.` }
  }

  /** Recusas da SEFAZ dos últimos dias, agrupadas pelo cStat (ou pelo texto, nas linhas antigas sem código). */
  private async rejeicoesRecentes(licencaIds: string[], agora: Date): Promise<RejeicaoAgrupada[]> {
    if (!licencaIds.length) return []
    const linhas = await prisma.emissaoLog.findMany({
      where: {
        licencaId: { in: licencaIds },
        acao:      'EMISSAO',
        resultado: 'erro',
        criadoEm:  { gte: new Date(agora.getTime() - JANELA_REJEICOES_DIAS * DIA) },
      },
      orderBy: { criadoEm: 'desc' },
      select:  { codigoSefaz: true, mensagem: true, criadoEm: true },
    })

    const grupos = new Map<string, RejeicaoAgrupada>()
    for (const l of linhas) {
      const motivo = (l.mensagem ?? 'sem mensagem').replace(/\[.*$/, '').slice(0, 120).trim()
      const chave = l.codigoSefaz != null ? `c${l.codigoSefaz}` : `m${motivo}`
      const g = grupos.get(chave)
      if (g) g.quantidade++
      // A primeira linha de cada grupo é a mais recente (orderBy desc).
      else grupos.set(chave, { codigoSefaz: l.codigoSefaz ?? null, motivo, quantidade: 1, ultimaEm: quando(l.criadoEm) })
    }
    return [...grupos.values()].sort((a, b) => b.quantidade - a.quantidade)
  }
}
