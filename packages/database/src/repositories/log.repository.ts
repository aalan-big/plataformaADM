import { prisma } from '../client'

/**
 * Registra uma ação administrativa na trilha de auditoria.
 *
 * Nunca deve derrubar a operação que está sendo auditada: se a gravação do log
 * falhar, o erro é engolido e reportado no console. Perder uma linha de log é
 * ruim; recusar um download legítimo de backup porque o log falhou é pior.
 */
export async function registrarLog(dados: {
  usuarioId?:   string | null
  acao:         string
  entidadeNome: string
  entidadeId?:  string | null
  descricao?:   string | null
  ipAddress?:   string | null
}) {
  try {
    return await prisma.log.create({
      data: {
        usuarioId:    dados.usuarioId    ?? null,
        acao:         dados.acao,
        entidadeNome: dados.entidadeNome,
        entidadeId:   dados.entidadeId   ?? null,
        descricao:    dados.descricao    ?? null,
        ipAddress:    dados.ipAddress    ?? null,
      },
    })
  } catch (err) {
    console.error('[log] falha ao registrar ação:', dados.acao, err)
    return null
  }
}

export async function findLogsPorEntidade(entidadeNome: string, entidadeId: string, limite = 50) {
  return prisma.log.findMany({
    where:   { entidadeNome, entidadeId },
    orderBy: { dataHora: 'desc' },
    take:    limite,
    include: { usuario: { select: { nome: true, email: true } } },
  })
}
