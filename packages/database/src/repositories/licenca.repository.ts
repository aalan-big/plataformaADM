import { randomUUID } from 'crypto'
import { prisma } from '../client'

/**
 * Os módulos vêm JUNTO com a licença, e não numa consulta à parte.
 *
 * Este include serve o caminho de validação, que todo ERP no ar percorre a cada
 * 24h. Resolver os módulos depois custaria duas idas ao banco por revalidação,
 * multiplicadas por toda a base — aqui elas viajam de carona numa query que já
 * estava acontecendo.
 */
const includeCompleto = {
  cliente: { include: { pf: true, pj: true } },
  plano:   { select: { nome: true, precoMensal: true, precoTrimestral: true, precoAnual: true, limiteUsuario: true, descontoTrimestral: true, descontoAnual: true, stripePriceIdMensal: true, stripePriceIdTrimestral: true, stripePriceIdAnual: true,
    modulos: { select: { cotaMensal: true, modulo: { select: { identificador: true, ativo: true } } } },
  } },
  modulosExtras: { select: { dataVencimento: true, cotaMensal: true, modulo: { select: { identificador: true, ativo: true } } } },
}

/** Formato mínimo que `modulosDaLicenca` precisa enxergar. */
type LicencaComModulos = {
  plano?:         { modulos?: { modulo: { identificador: string; ativo: boolean } }[] } | null
  modulosExtras?: { dataVencimento: Date | null; modulo: { identificador: string; ativo: boolean } }[]
}

/**
 * Lista consolidada de módulos que uma licença pode usar.
 *
 * União de "o que o plano inclui" com "o que foi contratado à parte", sem
 * duplicata. Extra vencido fica de fora, e módulo desativado no catálogo também
 * — desativar no catálogo é a forma de tirar um produto de circulação sem
 * precisar caçar todos os planos que o referenciam.
 *
 * Função pura, sobre dados já carregados: é ela que roda dentro da assinatura do
 * token, onde não pode haver await.
 */
export function modulosDaLicenca(licenca: LicencaComModulos, agora: Date = new Date()): string[] {
  const doPlano = (licenca.plano?.modulos ?? [])
    .filter(pm => pm.modulo.ativo)
    .map(pm => pm.modulo.identificador)

  const extras = (licenca.modulosExtras ?? [])
    .filter(e => e.modulo.ativo && (!e.dataVencimento || e.dataVencimento > agora))
    .map(e => e.modulo.identificador)

  return Array.from(new Set([...doPlano, ...extras])).sort()
}

export async function findLicencaById(id: string) {
  return prisma.licenca.findUnique({
    where: { id },
    include: includeCompleto,
  })
}

export async function findLicencasByClienteId(clienteId: string) {
  return prisma.licenca.findMany({
    where:   { clienteId },
    include: {
      plano:    { select: { nome: true, precoMensal: true } },
      historico: { orderBy: { criadoEm: 'desc' }, take: 10 },
    },
    orderBy: { criadoEm: 'desc' },
  })
}

export async function criarLicenca(dados: {
  clienteId:        string
  planoId:          string
  nomeDispositivo?: string
  dias?:            number
}) {
  const dias = dados.dias ?? 14
  const dataVencimento = new Date()
  dataVencimento.setDate(dataVencimento.getDate() + dias)

  const chaveAtivacao = `START-${randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`

  const licenca = await prisma.licenca.create({
    data: {
      clienteId:       dados.clienteId,
      planoId:         dados.planoId,
      nomeDispositivo: dados.nomeDispositivo,
      chaveAtivacao,
      isTrial:         true,
      status:          'ATIVA',
      diasCortesia:    dias,
      dataVencimento,
      chaveOrigem:     'TRIAL_MANUAL',
    },
    include: { plano: { select: { nome: true } } },
  })

  await prisma.licencaHistorico.create({
    data: {
      licencaId:     licenca.id,
      tipo:          'TRIAL',
      chaveAtivacao,
      dataVencimento,
      meses:         null,
      observacao:    `Trial de ${dias} dias criado manualmente`,
    },
  })

  return licenca
}

export async function updateLicenca(id: string, dados: Partial<{
  chaveAtivacao:       string
  status:              string
  planoId:             string
  isTrial:             boolean
  ultimoPagamento:     Date
  dataVencimento:      Date
  dataAtivacao:        Date
  nomeDispositivo:     string
  totalUsuarios:       number
  usuariosExtras:      number
  ultimoHeartbeat:      Date
  ultimaSincronizacao:  Date
  stripeSubscriptionId: string | null
  planoPendenteId:      string | null
  carenciaAte:          Date | null
}>) {
  // No Prisma 7, a relação obrigatória `plano` não aceita o escalar `planoId`
  // direto no update — precisa ser via `plano: { connect }`. Convertemos aqui
  // para manter a API do repositório simples (callers seguem passando planoId).
  const { planoId, ...resto } = dados
  return prisma.licenca.update({
    where: { id },
    data: {
      ...resto,
      ...(planoId ? { plano: { connect: { id: planoId } } } : {}),
    } as any,
  })
}

export async function atualizarTotalUsuarios(id: string, totalUsuarios: number) {
  return prisma.licenca.update({
    where: { id },
    data:  { totalUsuarios, ultimaSincronizacao: new Date() },
  })
}

export async function resetarTotalUsuarios(id: string) {
  return prisma.licenca.update({
    where: { id },
    data:  { totalUsuarios: 0 },
  })
}

export async function renovarLicencaComHistorico(id: string, dados: {
  chaveAtivacao:   string
  dataVencimento:  Date
  meses:           number
  ultimoPagamento: Date
}) {
  const licenca = await prisma.licenca.update({
    where: { id },
    data: {
      chaveAtivacao:   dados.chaveAtivacao,
      status:          'ATIVA',
      isTrial:         false,
      ultimoPagamento: dados.ultimoPagamento,
      dataVencimento:  dados.dataVencimento,
      // Renovar encerra a carencia, sempre. Ela e a janela em que o Stripe
      // re-tenta um cartao que falhou; com a licenca paga, nao ha mais o que
      // tolerar. Fica AQUI, e nao em cada chamador, porque todos os caminhos
      // de renovacao (checkout, ciclo do Stripe, PIX e manual) passam por esta
      // funcao — e um deles esquecer daria carencia perpetua ao cliente.
      carenciaAte:     null,
    },
  })

  await prisma.licencaHistorico.create({
    data: {
      licencaId:      id,
      tipo:           'RENOVACAO',
      chaveAtivacao:  dados.chaveAtivacao,
      dataVencimento: dados.dataVencimento,
      meses:          dados.meses,
      observacao:     `Renovado por ${dados.meses} ${dados.meses === 1 ? 'mês' : 'meses'}`,
    },
  })

  return licenca
}

export async function registrarEventoLicenca(licencaId: string, dados: {
  tipo:          string
  chaveAtivacao: string
  observacao?:   string
}) {
  return prisma.licencaHistorico.create({
    data: {
      licencaId:     licencaId,
      tipo:          dados.tipo,
      chaveAtivacao: dados.chaveAtivacao,
      meses:         null,
      dataVencimento: null,
      observacao:    dados.observacao,
    },
  })
}

export async function findAllLicencas(filtro?: {
  status?:  string
  isTrial?: boolean
  q?:       string
}) {
  return prisma.licenca.findMany({
    where: {
      ...(filtro?.status  ? { status:  filtro.status as any } : {}),
      ...(filtro?.isTrial !== undefined ? { isTrial: filtro.isTrial } : {}),
      ...(filtro?.q ? {
        OR: [
          { cliente: { pf: { nomeCompleto: { contains: filtro.q, mode: 'insensitive' } } } },
          { cliente: { pj: { razaoSocial:  { contains: filtro.q, mode: 'insensitive' } } } },
          { cliente: { email:              { contains: filtro.q, mode: 'insensitive' } } },
          { nomeDispositivo: { contains: filtro.q, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: {
      cliente: { include: { pf: true, pj: true } },
      plano:   { select: { nome: true, precoMensal: true } },
    },
    orderBy: { criadoEm: 'desc' },
    take: 200,
  })
}

export async function findHistoricoByLicenca(licencaId: string) {
  return prisma.licencaHistorico.findMany({
    where:   { licencaId },
    orderBy: { criadoEm: 'desc' },
  })
}

export async function findLicencasExpirandoOuVencidas(diasAlerta = 30) {
  const limite = new Date()
  limite.setDate(limite.getDate() + diasAlerta)

  return prisma.licenca.findMany({
    where: {
      OR: [
        { status: 'VENCIDA' },
        { status: 'ATIVA', dataVencimento: { lte: limite } },
      ],
    },
    include: {
      cliente: { include: { pf: true, pj: true } },
      plano:   { select: { nome: true, precoMensal: true } },
    },
    orderBy: { dataVencimento: 'asc' },
  })
}

export async function findLicencaByChave(chave: string) {
  return prisma.licenca.findFirst({
    where:   { chaveAtivacao: chave },
    include: includeCompleto,
  })
}

export async function batchAtualizarHeartbeat(ids: string[]) {
  if (ids.length === 0) return
  return prisma.licenca.updateMany({
    where: { id: { in: ids } },
    data:  { ultimoHeartbeat: new Date() },
  })
}

export async function findLicencaByStripeSubscriptionId(subscriptionId: string) {
  return prisma.licenca.findFirst({
    where:   { stripeSubscriptionId: subscriptionId },
    include: includeCompleto,
  })
}

export async function incrementarConexao(id: string) {
  return prisma.licenca.update({
    where: { id },
    data:  { totalUsuarios: { increment: 1 }, ultimoHeartbeat: new Date() },
  })
}

export async function decrementarConexao(id: string) {
  const atual = await prisma.licenca.findUnique({ where: { id }, select: { totalUsuarios: true } })
  const novoTotal = Math.max(0, (atual?.totalUsuarios ?? 1) - 1)
  return prisma.licenca.update({
    where: { id },
    data:  { totalUsuarios: novoTotal },
  })
}

export async function resetarConexoes(id: string) {
  return prisma.licenca.update({
    where: { id },
    data:  { totalUsuarios: 0 },
  })
}

export async function resetarSessoesInativas(antes: Date) {
  return prisma.licenca.updateMany({
    where: {
      ultimoHeartbeat: { lt: antes },
      totalUsuarios:   { gt: 0 },
    },
    data: { totalUsuarios: 0 },
  })
}

export async function deletarLicenca(id: string) {
  const temPagamentos = await prisma.pagamento.count({ where: { licencaId: id } })
  if (temPagamentos > 0) throw new Error('TEM_PAGAMENTOS')
  // historico cascades via schema; transacoes têm licencaId nullable (SetNull)
  return prisma.licenca.delete({ where: { id } })
}

export async function marcarLicencasVencidasBatch(): Promise<{ count: number }> {
  const agora = new Date()

  const licencas = await prisma.licenca.findMany({
    where: {
      status:         { in: ['ATIVA', 'AGUARDANDO'] as any[] },
      dataVencimento: { lt: agora },
    },
    select: { id: true, chaveAtivacao: true },
  })

  if (licencas.length === 0) return { count: 0 }

  const ids = licencas.map(l => l.id)

  await prisma.licenca.updateMany({
    where: { id: { in: ids } },
    data:  { status: 'VENCIDA' },
  })

  await prisma.licencaHistorico.createMany({
    data: licencas.map(l => ({
      licencaId:     l.id,
      tipo:          'VENCIMENTO',
      chaveAtivacao: l.chaveAtivacao,
      observacao:    'Licença expirada automaticamente pelo sistema',
    })),
    skipDuplicates: true,
  })

  return { count: licencas.length }
}
