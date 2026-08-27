import { prisma } from '../client'

/**
 * Cobranças de renovação — a intenção de pagar, registrada antes do pagamento.
 *
 * A regra que dá sentido a este arquivo: quando o webhook do gateway chegar,
 * NADA do que vier no corpo dele decide quanto tempo a licença ganha. O gateway
 * só diz "a cobrança X foi paga"; meses, valor e dono saem daqui.
 */

/**
 * Prazo do PIX, em dias, quando o Asaas não nos disser a validade real do QR.
 *
 * O `expiraEm` que guardamos precisa ser SEMPRE >= a janela que o Asaas aceita.
 * Se o nosso expirasse antes, a trava de idempotência liberaria um segundo PIX
 * enquanto o primeiro ainda é pagável — e o cliente que pagou o antigo pagaria
 * duas vezes. Por isso o valor autoritativo é o do QR; isto aqui é só o piso.
 */
export const DIAS_ATE_VENCIMENTO_PIX = 1

export async function criarCobrancaRenovacao(dados: {
  licencaId:  string
  clienteId:  string
  planoId:    string
  meses:      number
  valor:      number
  /**
   * Parte do `valor` que é do plano, sem os módulos avulsos. Omitido significa
   * "tudo plano" — o caso de toda cobrança que não envolve módulo.
   */
  valorPlano?: number
  gateway:    string
  metodo:     string
  expiraEm?:  Date | null
}) {
  return prisma.cobrancaRenovacao.create({
    data: {
      licencaId:  dados.licencaId,
      clienteId:  dados.clienteId,
      planoId:    dados.planoId,
      meses:      dados.meses,
      valor:      dados.valor,
      valorPlano: dados.valorPlano ?? dados.valor,
      gateway:   dados.gateway,
      metodo:    dados.metodo,
      status:    'PENDENTE',
      expiraEm:  dados.expiraEm ?? null,
    },
  })
}

/**
 * A trava de idempotência (I3 do contrato do ERP): dois cliques no botão de
 * pagar, ou o operador reabrindo a tela, têm que cair na MESMA cobrança.
 *
 * `expiraEm` entra na busca porque cobrança vencida não serve para reaproveitar
 * — o copia-e-cola dela já não é aceito pelo banco. Uma linha PENDENTE mas
 * expirada é lixo: quem chamar de novo precisa de um PIX novo, não do velho.
 */
export async function findCobrancaPendente(dados: {
  licencaId: string
  meses:     number
  metodo:    string
  /**
   * O plano sendo pago entra na chave porque uma renovação e uma troca de plano
   * podem coexistir para a mesma licença e período, com valores diferentes.
   * Sem isto, gerar a cobrança da troca devolveria o PIX da renovação — e o
   * cliente pagaria o valor errado achando que estava mudando de plano.
   */
  planoId?:  string
}) {
  return prisma.cobrancaRenovacao.findFirst({
    where: {
      licencaId: dados.licencaId,
      meses:     dados.meses,
      metodo:    dados.metodo,
      ...(dados.planoId ? { planoId: dados.planoId } : {}),
      status:    'PENDENTE',
      OR: [
        { expiraEm: null },
        { expiraEm: { gt: new Date() } },
      ],
    },
    orderBy: { criadoEm: 'desc' },
  })
}

export async function findCobrancaRenovacaoById(id: string) {
  return prisma.cobrancaRenovacao.findUnique({ where: { id } })
}

/** Usada pelo webhook: o gateway conhece a cobrança pelo id DELE. */
export async function findCobrancaByGatewayId(gatewayCobrancaId: string) {
  return prisma.cobrancaRenovacao.findUnique({ where: { gatewayCobrancaId } })
}

/** Grava o que o gateway devolveu depois de criada a cobrança lá (id, QR, URL). */
export async function anexarDadosDoGateway(id: string, dados: {
  gatewayCobrancaId?: string
  copiaECola?:        string | null
  qrCodeBase64?:      string | null
  urlCheckout?:       string | null
  expiraEm?:          Date | null
}) {
  return prisma.cobrancaRenovacao.update({ where: { id }, data: dados })
}

/**
 * Marca a cobrança como paga.
 *
 * Chamada DEPOIS de a licença já ter sido estendida — nunca antes (I2). O ERP
 * trata `PAGA` como "pode revalidar agora": na ordem inversa ele revalidaria,
 * receberia a data velha, e o cliente que acabou de pagar veria o sistema ainda
 * travado. A ordem aqui é parte do contrato, não detalhe de implementação.
 */
export async function marcarCobrancaPaga(id: string, dados: {
  pagamentoId?: string
  pagoEm?:      Date
}) {
  return prisma.cobrancaRenovacao.update({
    where: { id },
    data: {
      status:      'PAGA',
      pagoEm:      dados.pagoEm ?? new Date(),
      pagamentoId: dados.pagamentoId,
    },
  })
}

export async function marcarCobrancaStatus(id: string, status: 'EXPIRADA' | 'CANCELADA') {
  return prisma.cobrancaRenovacao.update({ where: { id }, data: { status } })
}

/** Varredura de manutenção: fecha as pendentes cujo prazo já passou. */
export async function expirarCobrancasVencidas() {
  return prisma.cobrancaRenovacao.updateMany({
    where:  { status: 'PENDENTE', expiraEm: { lt: new Date() } },
    data:   { status: 'EXPIRADA' },
  })
}

export async function findCobrancasByLicencaId(licencaId: string) {
  return prisma.cobrancaRenovacao.findMany({
    where:   { licencaId },
    orderBy: { criadoEm: 'desc' },
  })
}

/**
 * Listagem para o painel do admin.
 *
 * Diferente de `findAllPagamentos`, que só enxerga dinheiro que ENTROU, aqui
 * aparece também o que foi gerado e não pagou. É a única fonte de "quantos PIX
 * abrimos e quantos converteram" — e PIX gerado e abandonado é informação de
 * venda perdida, não lixo.
 */
export async function findCobrancasRenovacao(filtro?: {
  status?: string
  limite?: number
}) {
  return prisma.cobrancaRenovacao.findMany({
    where:   filtro?.status ? { status: filtro.status } : {},
    orderBy: { criadoEm: 'desc' },
    take:    filtro?.limite ?? 100,
    include: {
      cliente: { select: { email: true, pf: { select: { nomeCompleto: true } }, pj: { select: { razaoSocial: true } } } },
      licenca: { select: { nomeDispositivo: true, chaveAtivacao: true, status: true, dataVencimento: true } },
      plano:   { select: { nome: true } },
    },
  })
}

/** Contagem por status, para o resumo do painel. */
export async function contarCobrancasPorStatus() {
  const linhas = await prisma.cobrancaRenovacao.groupBy({ by: ['status'], _count: true })
  return linhas.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = l._count
    return acc
  }, {})
}

/**
 * Fecha os PIX pendentes de uma licença.
 *
 * Chamado quando um módulo avulso é concedido ou revogado, porque o valor da
 * cobrança muda e a trava de idempotência NÃO olha valor — ela casa por licença,
 * meses, método e plano. Sem isto:
 *
 *   1. cliente gera o PIX de R$ 59,90
 *   2. você concede NF-e por R$ 50,00
 *   3. ele paga os R$ 59,90 que já estavam na tela
 *   4. o módulo renova junto, e os R$ 50,00 nunca foram cobrados
 *
 * O inverso é pior: revogar um módulo deixaria de pé um PIX cobrando por algo
 * que o cliente não tem mais.
 *
 * Cancelar é seguro porque uma cobrança PENDENTE é só intenção — ninguém pagou.
 * O próximo pedido gera um PIX novo, com o valor certo.
 */
export async function cancelarPixPendentesDaLicenca(licencaId: string) {
  return prisma.cobrancaRenovacao.updateMany({
    where: { licencaId, status: 'PENDENTE', metodo: 'PIX' },
    data:  { status: 'CANCELADA' },
  })
}
