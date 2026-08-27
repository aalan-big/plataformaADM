import { prisma } from '../client'

// ── Queries ───────────────────────────────────────────────────────────────────

export async function findAllPlanos() {
  return prisma.plano.findMany({
    where:   { status: 'ATIVO' },
    orderBy: { precoMensal: 'asc' },
    select:  { id: true, nome: true, precoMensal: true, limiteUsuario: true },
  })
}

export async function findAllPlanosAdmin() {
  return prisma.plano.findMany({
    orderBy: { criadoEm: 'asc' },
    include: { _count: { select: { licencas: true } }, modulos: { include: { modulo: true } } },
  })
}

export async function findPlanoById(id: string) {
  return prisma.plano.findUnique({
    where:   { id },
    include: { _count: { select: { licencas: true } }, modulos: { include: { modulo: true } } },
  })
}

export async function findPlanoByNome(nome: string) {
  return prisma.plano.findUnique({ where: { nome } })
}

export async function countLicencasAtivasByPlano(planoId: string) {
  return prisma.licenca.count({
    where: { planoId, status: { in: ['ATIVA', 'AGUARDANDO'] } },
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Planos que aparecem na página pública de contratação: ATIVO e marcados como
 * públicos. O filtro mora aqui para que nenhuma tela precise lembrar dele —
 * esquecer significaria expor preço de canal interno na vitrine.
 */
export async function findPlanosPublicos() {
  return prisma.plano.findMany({
    where:   { status: 'ATIVO', publico: true },
    orderBy: { precoMensal: 'asc' },
  })
}

export async function criarPlano(data: {
  nome:                    string
  descricaoCheckout?:      string
  publico?:                boolean
  limiteUsuario:           number
  precoMensal:             number
  precoTrimestral?:        number
  precoAnual?:             number
  valorLicencaAdicional?:  number
  descontoTrimestral?:     number
  descontoAnual?:          number
  stripePriceIdMensal?:    string
  stripePriceIdTrimestral?: string
  stripePriceIdAnual?:     string
}) {
  return prisma.plano.create({ data })
}

export async function updatePlano(id: string, data: {
  nome?:                   string
  descricaoCheckout?:      string | null
  publico?:                boolean
  limiteUsuario?:          number
  precoMensal?:            number
  precoTrimestral?:        number | null
  precoAnual?:             number | null
  valorLicencaAdicional?:  number | null
  descontoTrimestral?:     number | null
  descontoAnual?:          number | null
  stripePriceIdMensal?:    string | null
  stripePriceIdTrimestral?: string | null
  stripePriceIdAnual?:     string | null
  status?:                 string
}) {
  return prisma.plano.update({ where: { id }, data })
}
