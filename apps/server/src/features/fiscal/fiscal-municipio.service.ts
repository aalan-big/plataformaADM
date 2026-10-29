import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { prisma } from '@startbig/database'
import { FocusNfeService } from '../../common/focus-nfe/focus-nfe.service'
import { buscarEmpresaConfig } from './fiscal-comum'

/**
 * As cidades da NFS-e (G6 da NFS-e no ERP, backend-fastapi/docs/nfse-fase2-plano.md).
 *
 * Duas fontes, que não se misturam:
 * - a FOCUS diz como está o webservice da prefeitura e o que ela exige
 *   (`/v2/municipios/{ibge}`), cacheado em `MunicipioNfse` por um dia;
 * - o SUPORTE decide por onde sai a nota de quem não é MEI (`rotaNaoMei`) e se
 *   a prefeitura pede login. Nenhuma consulta à Focus sobrescreve isso.
 *
 * Uma cidade nova entra na tabela sozinha, como `DESCONHECIDA`, na primeira
 * ativação de um cliente dela: é assim que o suporte fica sabendo que tem
 * cidade para decidir.
 */

export const ROTAS_NAO_MEI = ['NACIONAL', 'MUNICIPAL', 'DESCONHECIDA'] as const
export type RotaNaoMei = typeof ROTAS_NAO_MEI[number]

/** Rotas que a ficha aceita (a `MUNICIPAL_PENDENTE` só a ativação grava). */
export const ROTAS_DA_FICHA = ['NACIONAL', 'MUNICIPAL'] as const

const UM_DIA_MS = 24 * 60 * 60 * 1000
const SUFIXO_OBRIGATORIO = '_obrigatorio_nfse'

/** O `codigo_municipio` (IBGE, 7 dígitos) do endereço do emitente, se veio. */
export function codigoIbgeDoEmitente(emitente: Record<string, any> | undefined): string | null {
  const end = emitente?.endereco ?? {}
  const codigo = String(end.codigo_municipio ?? end.codigo_ibge ?? '').replace(/\D/g, '')
  return codigo.length === 7 ? codigo : null
}

/** A resposta da Focus nas colunas do cache. */
export function cacheDaFocus(m: Record<string, any>) {
  const obrigatorios: Record<string, boolean | null> = {}
  for (const [campo, valor] of Object.entries(m ?? {})) {
    if (campo.endsWith(SUFIXO_OBRIGATORIO)) {
      obrigatorios[campo.slice(0, -SUFIXO_OBRIGATORIO.length)] = typeof valor === 'boolean' ? valor : null
    }
  }
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null)
  return {
    nfseHabilitada:     bool(m?.nfse_habilitada),
    statusNfse:         typeof m?.status_nfse === 'string' ? m.status_nfse : null,
    provedorNfse:       typeof m?.provedor_nfse === 'string' ? m.provedor_nfse : null,
    requerCertificado:  bool(m?.requer_certificado_nfse),
    possuiHomologacao:  bool(m?.possui_ambiente_homologacao_nfse),
    possuiCancelamento: bool(m?.possui_cancelamento_nfse),
    obrigatorios,
    consultadoFocusEm:  new Date(),
  }
}

function tokenDaConta(): string | null {
  return process.env.FOCUS_NFE_PARTNER_TOKEN?.trim() || process.env.FOCUS_CONTA_TOKEN?.trim() || null
}

@Injectable()
export class FiscalMunicipioService {
  private readonly logger = new Logger(FiscalMunicipioService.name)

  constructor(private readonly focusNfeService: FocusNfeService) {}

  /**
   * O código IBGE do emitente: o que o ERP mandou ou, sem ele (ERP anterior à
   * G6), a busca por nome + UF na Focus. Falha vira `null` — quem chama decide
   * o que fazer sem a cidade (a ativação segue com a rota pendente).
   */
  async codigoDoEmitente(emitente: Record<string, any>): Promise<string | null> {
    const direto = codigoIbgeDoEmitente(emitente)
    if (direto) return direto
    const end = emitente?.endereco ?? {}
    const nome = String(end.cidade ?? end.municipio ?? '').trim()
    const uf = String(end.uf ?? '').trim()
    const token = tokenDaConta()
    if (!nome || uf.length !== 2 || !token) return null
    try {
      const achado = await this.focusNfeService.buscarMunicipioPorNome(token, nome, uf)
      const codigo = String(achado?.codigo_municipio ?? '').replace(/\D/g, '')
      return codigo.length === 7 ? codigo : null
    } catch (erro) {
      this.logger.warn(`Cidade ${nome}/${uf} não resolvida na Focus: ${erro instanceof Error ? erro.message : erro}`)
      return null
    }
  }

  /**
   * A cidade, com o cache da Focus em dia (`forcar` ignora a idade). Cria a
   * linha (`DESCONHECIDA`) quando não existe. Focus fora do ar devolve o que
   * houver no banco — cache velho é melhor do que nenhum, e a decisão do
   * suporte não depende da Focus.
   */
  async obter(codigoIbge: string, opcoes: { forcar?: boolean; nome?: string; uf?: string } = {}) {
    const atual = await prisma.municipioNfse.findUnique({ where: { codigoIbge } })
    const fresco = atual?.consultadoFocusEm && Date.now() - new Date(atual.consultadoFocusEm).getTime() < UM_DIA_MS
    if (atual && fresco && !opcoes.forcar) return atual

    const token = tokenDaConta()
    let daFocus: any = null
    if (token) {
      try {
        daFocus = await this.focusNfeService.consultarMunicipio(token, codigoIbge)
      } catch (erro) {
        this.logger.warn(`Município ${codigoIbge}: Focus indisponível (${erro instanceof Error ? erro.message : erro}); usando o que há no banco.`)
        if (opcoes.forcar) throw erro
        return atual
      }
    }

    const nome = String(daFocus?.nome_municipio ?? atual?.nome ?? opcoes.nome ?? '').trim() || codigoIbge
    const uf = String(daFocus?.sigla_uf ?? atual?.uf ?? opcoes.uf ?? '').trim().toUpperCase()
    const cache = daFocus ? cacheDaFocus(daFocus) : {}
    return prisma.municipioNfse.upsert({
      where:  { codigoIbge },
      update: { nome, uf, ...cache },
      create: { codigoIbge, nome, uf, ...cache },
    })
  }

  /**
   * O que o ERP precisa para a NFS-e (`GET /erp/fiscal/nfse/municipio`): a rota
   * da ficha e o que a cidade exige. Sem cidade conhecida, a rota vem sozinha
   * e `municipio` null — o ERP cai nas regras da Nacional.
   */
  async exigenciasDaLicenca(licencaId: string) {
    const config = await buscarEmpresaConfig(licencaId)
    if (!config) {
      throw new NotFoundException({ codigo: 'SEM_CONFIGURACAO_FISCAL', mensagem: 'Empresa não possui configuração fiscal ativa.' })
    }
    const municipio = config.nfseCodigoMunicipio ? await this.obter(config.nfseCodigoMunicipio) : null
    return {
      rota: config.nfseRota ?? 'NACIONAL',
      municipio: municipio
        ? {
            codigo_ibge:         municipio.codigoIbge,
            nome:                municipio.nome,
            uf:                  municipio.uf,
            status_nfse:         municipio.statusNfse,
            provedor:            municipio.provedorNfse,
            possui_homologacao:  municipio.possuiHomologacao,
            possui_cancelamento: municipio.possuiCancelamento,
            exige_login:         municipio.exigeLoginPrefeitura,
            obrigatorios:        (municipio.obrigatorios as Record<string, boolean | null> | null) ?? {},
          }
        : null,
    }
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  /** Todas as cidades conhecidas, com quantos clientes cada uma tem na ficha. */
  async listar() {
    const [cidades, fichas] = await Promise.all([
      prisma.municipioNfse.findMany({ orderBy: { nome: 'asc' } }),
      prisma.empresaFiscalConfig.findMany({
        where:  { nfseCodigoMunicipio: { not: null } },
        select: { nfseCodigoMunicipio: true, nfseRota: true },
      }),
    ])
    return cidades.map(c => {
      const daCidade = fichas.filter(f => f.nfseCodigoMunicipio === c.codigoIbge)
      return {
        ...c,
        clientes:  daCidade.length,
        pendentes: daCidade.filter(f => f.nfseRota === 'MUNICIPAL_PENDENTE').length,
      }
    })
  }

  /**
   * A decisão do suporte. Não mexe em ficha nenhuma: os clientes da cidade
   * passam a usar a rota nova na próxima ativação, ou quando o admin trocar a
   * rota da ficha (o que reconfigura a empresa na Focus).
   */
  async decidir(codigoIbge: string, dados: { rotaNaoMei?: RotaNaoMei; exigeLoginPrefeitura?: boolean; observacao?: string | null }) {
    const atual = await prisma.municipioNfse.findUnique({ where: { codigoIbge } })
    if (!atual) throw new NotFoundException({ codigo: 'MUNICIPIO_NAO_ENCONTRADO', mensagem: 'Cidade ainda não cadastrada.' })
    const data: Record<string, unknown> = {}
    if (dados.rotaNaoMei !== undefined) data.rotaNaoMei = dados.rotaNaoMei
    if (dados.exigeLoginPrefeitura !== undefined) data.exigeLoginPrefeitura = dados.exigeLoginPrefeitura
    if (dados.observacao !== undefined) data.observacao = dados.observacao?.trim() || null
    return prisma.municipioNfse.update({ where: { codigoIbge }, data })
  }

  /**
   * Troca a rota da NFS-e de UMA ficha e reconfigura a empresa na Focus. As
   * duas chaves vão explícitas: a Focus recusa a municipal e a Nacional de
   * produção ligadas juntas, e a troca precisa desligar a anterior.
   */
  async trocarRotaDaFicha(clienteId: string, rota: typeof ROTAS_DA_FICHA[number]) {
    const ficha = await prisma.empresaFiscalConfig.findUnique({ where: { clienteId } })
    if (!ficha) throw new NotFoundException({ codigo: 'SEM_CONFIGURACAO_FISCAL', mensagem: 'Cliente sem configuração fiscal.' })
    if (!ficha.focusEmpresaId) {
      throw new BadRequestException({ codigo: 'SEM_EMPRESA_NA_FOCUS', mensagem: 'A empresa ainda não foi ativada na emissora. Peça ao cliente para enviar o certificado pelo ERP.' })
    }
    const token = tokenDaConta()
    if (!token) {
      throw new HttpException({ codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA', mensagem: 'Token da conta Focus ausente nesta plataforma.' }, HttpStatus.NOT_IMPLEMENTED)
    }
    await this.focusNfeService.atualizarEmpresa(token, ficha.focusEmpresaId, flagsDaRota(rota))
    await prisma.empresaFiscalConfig.update({ where: { clienteId }, data: { nfseRota: rota } })
    this.logger.log(`Rota da NFS-e do cliente ${clienteId} trocada para ${rota} (empresa ${ficha.focusEmpresaId} reconfigurada na Focus).`)
    return { clienteId, nfseRota: rota }
  }
}

/** As chaves da Focus para a troca manual (as duas, explícitas). */
export function flagsDaRota(rota: string): Record<string, boolean> {
  return rota === 'MUNICIPAL'
    ? { habilita_nfse: true, habilita_nfsen_producao: false, habilita_nfsen_homologacao: false }
    : { habilita_nfse: false, habilita_nfsen_producao: true, habilita_nfsen_homologacao: true }
}
