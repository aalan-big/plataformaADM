import { prisma } from '../client'

export type StatusEmail = 'ENVIADO' | 'FALHOU' | 'NAO_ENVIADO'

export async function registrarEmail(dados: {
  tipo:         string
  destinatario: string
  assunto:      string
  status:       StatusEmail
  erro?:        string | null
  resendId?:    string | null
  html:         string
}) {
  return prisma.emailLog.create({ data: dados })
}

/** Filtros da tela E-mails. `q` procura no destinatário e no assunto. */
export type FiltroEmails = {
  status?:   string
  tipo?:     string
  q?:        string
  pagina:    number
  porPagina: number
}

function whereDe(f: Omit<FiltroEmails, 'pagina' | 'porPagina'>) {
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.tipo   ? { tipo:   f.tipo }   : {}),
    ...(f.q ? {
      OR: [
        { destinatario: { contains: f.q, mode: 'insensitive' as const } },
        { assunto:      { contains: f.q, mode: 'insensitive' as const } },
      ],
    } : {}),
  }
}

/** Página do histórico, mais recente primeiro. Sem o HTML: ele vem no detalhe. */
export async function listarEmails(f: FiltroEmails) {
  const where = whereDe(f)
  const [itens, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      skip:    (f.pagina - 1) * f.porPagina,
      take:    f.porPagina,
      select:  { id: true, tipo: true, destinatario: true, assunto: true, status: true, erro: true, resendId: true, criadoEm: true },
    }),
    prisma.emailLog.count({ where }),
  ])
  return { itens, total }
}

export async function buscarEmail(id: string) {
  return prisma.emailLog.findUnique({ where: { id } })
}

/** Quantos de cada status desde `desde` — os números do topo da tela. */
export async function resumoEmails(desde: Date) {
  const contar = (status: StatusEmail) => prisma.emailLog.count({ where: { status, criadoEm: { gte: desde } } })
  const [enviados, falhas, naoEnviados] = await Promise.all([contar('ENVIADO'), contar('FALHOU'), contar('NAO_ENVIADO')])
  return { enviados, falhas, naoEnviados }
}
