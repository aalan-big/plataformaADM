import { prisma } from '../client'

export type TipoBackupDb = 'BANCO' | 'IMAGENS'

/// 00:00 de hoje no fuso de São Paulo, expresso como instante UTC.
///
/// O corte do limite diário é pelo relógio do SERVIDOR, nunca pelo do cliente:
/// mexer na data da máquina não pode virar mais uploads na sua conta. E é pelo
/// fuso de SP porque "2 backups por dia" tem que virar dia para quem está no
/// Brasil, não à meia-noite de Greenwich (que aqui são 21h do dia anterior).
export function inicioDoDiaSaoPaulo(agora: Date = new Date()): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    hour12:   false,
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
  }).formatToParts(agora)

  const valor = (tipo: string) => Number(partes.find(p => p.type === tipo)?.value ?? 0)

  // Quanto já passou da meia-noite local. Subtraindo de "agora" chega-se ao
  // instante da meia-noite local sem precisar saber o offset (nem se mudou).
  const decorridoMs =
    (valor('hour') % 24) * 3_600_000 +
    valor('minute')      *    60_000 +
    valor('second')      *     1_000 +
    agora.getMilliseconds()

  return new Date(agora.getTime() - decorridoMs)
}

export async function criarBackup(dados: {
  clienteId:      string
  licencaId:      string
  hwid:           string | null
  tipo:           TipoBackupDb
  chaveS3:        string
  origem:         string
  tamanhoBytes:   number
  checksumSha256: string | null
}) {
  return prisma.backup.create({ data: dados })
}

export async function findBackupById(id: string) {
  return prisma.backup.findUnique({ where: { id } })
}

export async function marcarBackupConfirmado(id: string, tamanhoRealBytes: number) {
  return prisma.backup.update({
    where: { id },
    data:  { status: 'CONFIRMADO', confirmadoEm: new Date(), tamanhoRealBytes },
  })
}

export async function marcarBackupFalhou(id: string, erroMensagem: string) {
  return prisma.backup.update({
    where: { id },
    data:  { status: 'FALHOU', erroMensagem },
  })
}

/// Quantos uploads contam contra a cota de hoje nesta licença/tipo.
///
/// Conta URL EMITIDA, não só confirmada: URL assinada entregue já é custo em
/// potencial, então um loop com bug que pede 500 URLs e nunca sobe também bate
/// no teto.
///
/// Mas NÃO conta o que falhou. Loja com internet de rádio perde upload no meio
/// o tempo todo; se cada queda gastasse uma vaga, o cliente ficaria o dia
/// inteiro sem conseguir backup nenhum — justamente quem mais precisa. Quem
/// reporta a falha pelo /confirmar recupera a vaga; quem trava sem reportar
/// continua consumindo até o varredor marcar como FALHOU, que é o certo.
export async function contarBackupsDoDia(licencaId: string, tipo: TipoBackupDb) {
  return prisma.backup.count({
    where: {
      licencaId,
      tipo,
      emitidoEm: { gte: inicioDoDiaSaoPaulo() },
      status:    { not: 'FALHOU' },
    },
  })
}

export async function findUltimoBackupConfirmado(licencaId: string, tipo: TipoBackupDb) {
  return prisma.backup.findFirst({
    where:   { licencaId, tipo, status: 'CONFIRMADO' },
    orderBy: { emitidoEm: 'desc' },
  })
}

export async function findBackupsRecentes(licencaId: string, limite = 30) {
  return prisma.backup.findMany({
    where:   { licencaId },
    orderBy: { emitidoEm: 'desc' },
    take:    limite,
  })
}

export async function findBackupsPorCliente(clienteId: string, limite = 60) {
  return prisma.backup.findMany({
    where:   { clienteId },
    orderBy: { emitidoEm: 'desc' },
    take:    limite,
  })
}

/// URLs emitidas que nunca confirmaram e já passaram do TTL — o ERP caiu no meio
/// do upload, ou subiu e não avisou. Sem varrer isso o painel mostra "backup de
/// hoje ✔" para arquivo que talvez não exista.
export async function findBackupsPendentesExpirados(minutos: number) {
  const limite = new Date(Date.now() - minutos * 60_000)
  return prisma.backup.findMany({
    where: { status: 'EMITIDO', emitidoEm: { lt: limite } },
  })
}

/// Licenças cujo backup está elegível a ser apagado da nuvem: sem nenhuma licença
/// ATIVA e paradas há mais de `dias`. Devolve o par cliente/licença para montar
/// o prefixo, e o e-mail para avisar antes de apagar.
export async function findBackupsDeLicencasMortas(dias: number) {
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)

  const linhas = await prisma.backup.findMany({
    where: {
      status:    'CONFIRMADO',
      emitidoEm: { lt: limite },
      licenca:   { status: { not: 'ATIVA' } },
    },
    distinct: ['licencaId'],
    orderBy:  { emitidoEm: 'desc' },
    select: {
      clienteId: true,
      licencaId: true,
      emitidoEm: true,
      cliente:   { select: { email: true } },
      licenca:   { select: { status: true, dataVencimento: true } },
    },
  })

  return linhas
}

export async function deletarBackupsDaLicenca(licencaId: string) {
  return prisma.backup.deleteMany({ where: { licencaId } })
}

/// Uma linha por licença com o estado do backup, para a tela do admin.
///
/// Inclui licenças que NUNCA fizeram backup de propósito: a pergunta que essa
/// tela responde não é "quem fez backup", é "quem deveria estar fazendo e não
/// está". Cliente pagante sem nenhuma cópia na nuvem é o caso que importa, e ele
/// some se a consulta partir da tabela de backups.
export async function findVisaoGeralDeBackups() {
  const [licencas, ultimos, falhas] = await Promise.all([
    prisma.licenca.findMany({
      select: {
        id:              true,
        status:          true,
        isTrial:         true,
        nomeDispositivo: true,
        dataVencimento:  true,
        clienteId:       true,
        plano:   { select: { nome: true } },
        cliente: {
          select: {
            id:    true,
            email: true,
            pf:    { select: { nomeCompleto: true } },
            pj:    { select: { razaoSocial:  true } },
          },
        },
      },
      orderBy: { criadoEm: 'desc' },
    }),

    // `distinct` com `orderBy` desc devolve a linha mais recente de cada
    // (licença, tipo) — que é exatamente o arquivo que existe na nuvem hoje.
    prisma.backup.findMany({
      where:    { status: 'CONFIRMADO' },
      distinct: ['licencaId', 'tipo'],
      orderBy:  { emitidoEm: 'desc' },
      select: {
        licencaId:        true,
        tipo:             true,
        tamanhoBytes:     true,
        tamanhoRealBytes: true,
        confirmadoEm:     true,
        emitidoEm:        true,
        hwid:             true,
        chaveS3:          true,
      },
    }),

    prisma.backup.groupBy({
      by:    ['licencaId'],
      where: {
        status:    'FALHOU',
        emitidoEm: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      _count: { _all: true },
    }),
  ])

  return { licencas, ultimos, falhas }
}

/// Diário de eventos de uma licença, para a gaveta de detalhe.
export async function findEventosDeBackup(licencaId: string, limite = 50) {
  return prisma.backup.findMany({
    where:   { licencaId },
    orderBy: { emitidoEm: 'desc' },
    take:    limite,
  })
}

/// Todos os ids de licença que existem. Usado pela varredura de órfãos para
/// decidir o que na nuvem não tem mais dono.
export async function findTodosIdsDeLicenca(): Promise<string[]> {
  const linhas = await prisma.licenca.findMany({ select: { id: true } })
  return linhas.map(l => l.id)
}

/// Licenças sem backup confirmado há mais de `dias`, cuja licença não está
/// ATIVA — as candidatas a ter o backup apagado pela retenção. Serve para o
/// aviso prévio, que precisa saber quantos dias faltam antes de apagar.
export async function findLicencasParaAvisoDeRetencao(dias: number) {
  const alvo = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
  const inicio = new Date(alvo.getTime() - 12 * 60 * 60 * 1000)
  const fim    = new Date(alvo.getTime() + 12 * 60 * 60 * 1000)

  return prisma.backup.findMany({
    where: {
      status:    'CONFIRMADO',
      emitidoEm: { gte: inicio, lt: fim },
      licenca:   { status: { not: 'ATIVA' } },
    },
    distinct: ['licencaId'],
    select: {
      licencaId: true,
      clienteId: true,
      emitidoEm: true,
      cliente: {
        select: {
          email: true,
          pf: { select: { nomeCompleto: true } },
          pj: { select: { razaoSocial:  true } },
        },
      },
    },
  })
}

/// Poda do diário de eventos. O arquivo na nuvem é um só; guardar 5 anos de
/// linhas dizendo "subiu 31 MB" não serve para nada além de engordar a tabela.
export async function podarEventosDeBackup(dias: number) {
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
  return prisma.backup.deleteMany({ where: { emitidoEm: { lt: limite } } })
}
