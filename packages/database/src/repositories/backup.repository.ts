import { prisma } from '../client'

export type TipoBackupDb = 'FULL' | 'FRAGMENTO'

/// Ciclo corrente em 'YYYY-MM-DD': a SEGUNDA-FEIRA da semana atual, no fuso de
/// São Paulo.
///
/// O fuso importa: no domingo às 22h em SP já é segunda em UTC. Usar UTC abriria
/// o ciclo novo um dia antes para quem está no Brasil, e o full seria cobrado do
/// cliente num domingo à noite.
///
/// Só o servidor calcula isto. O ERP lê `cicloCorrente` do /status — se ele
/// derivasse da própria máquina, um PC com a data errada faria o full no dia
/// errado, ou nunca faria.
export function cicloAtual(agora: Date = new Date()): string {
  // Resolve primeiro qual é o dia do calendário em SP; só depois faz aritmética.
  const hojeLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(agora)

  // A partir daqui é aritmética de calendário pura, em UTC: a data local já foi
  // resolvida acima, e UTC não tem horário de verão para deslocar o resultado.
  const dia = new Date(`${hojeLocal}T00:00:00Z`)
  const diaDaSemana  = dia.getUTCDay()             // 0 = domingo … 6 = sábado
  const desdeSegunda = (diaDaSemana + 6) % 7       // domingo → 6, segunda → 0
  dia.setUTCDate(dia.getUTCDate() - desdeSegunda)

  return dia.toISOString().slice(0, 10)
}

/// 00:00 de hoje no fuso de São Paulo, expresso como instante UTC.
///
/// O corte do limite diário é pelo relógio do SERVIDOR, nunca pelo do cliente:
/// mexer na data da máquina não pode virar mais uploads na sua conta. E é pelo
/// fuso de SP porque "2 backups por dia" tem que virar dia para quem está no
/// Brasil, não à meia-noite de Greenwich (que aqui são 21h do dia anterior).
function inicioDoDiaSaoPaulo(agora: Date = new Date()): Date {
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
  ciclo:          string
  sequencia:      number
  chaveS3:        string
  origem:         string
  tamanhoBytes:   number
  codigoConteudo: string
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
export async function contarBackupsDoDia(licencaId: string) {
  return prisma.backup.count({
    where: {
      licencaId,
      emitidoEm: { gte: inicioDoDiaSaoPaulo() },
      status:    { not: 'FALHOU' },
    },
  })
}

/// O último envio confirmado da licença, qualquer que seja o ciclo ou o tipo.
///
/// É contra o `codigoConteudo` DESTA linha que o envio novo é comparado. Contra o
/// último CONFIRMADO, nunca contra uma linha ainda emitida: se o código fosse
/// promovido na autorização e o upload morresse no meio, no login seguinte o ERP
/// mandaria o mesmo código, bateria, e responderíamos "nada novo" — o conteúdo
/// nunca subiria e nenhum erro apareceria em lugar nenhum.
export async function findUltimoBackupConfirmado(licencaId: string) {
  return prisma.backup.findFirst({
    where:   { licencaId, status: 'CONFIRMADO' },
    orderBy: { emitidoEm: 'desc' },
  })
}

/// O FULL confirmado mais recente da licença, de qualquer ciclo.
///
/// É a referência da checagem de queda suspeita, e ela compara FULL com FULL de
/// propósito: fragmento é por desenho muito menor que o full, então comparar os
/// dois faria a trava disparar em todo primeiro fragmento da semana.
export async function findUltimoFullConfirmado(licencaId: string) {
  return prisma.backup.findFirst({
    where:   { licencaId, tipo: 'FULL', status: { in: ['CONFIRMADO', 'REMOVIDO'] } },
    orderBy: { emitidoEm: 'desc' },
  })
}

/// O FULL confirmado deste ciclo, se já houver. É o que responde as duas
/// perguntas do início do dia: "o próximo envio é full ou fragmento?" e "já dá
/// para apagar o ciclo anterior?".
export async function findFullConfirmadoDoCiclo(licencaId: string, ciclo: string) {
  return prisma.backup.findFirst({
    where:   { licencaId, ciclo, tipo: 'FULL', status: 'CONFIRMADO' },
    orderBy: { emitidoEm: 'desc' },
  })
}

/// A corrente do ciclo, na ORDEM DE EXTRAÇÃO: o full primeiro, depois cada
/// fragmento. É o que a restauração baixa inteiro.
///
/// Ordena por `sequencia`, não por data: restaurar fora de ordem produz um banco
/// silenciosamente errado, e empate de relógio não pode decidir isso.
///
/// `REMOVIDO` fica de fora — a linha existe para o histórico, mas o objeto não
/// está mais na nuvem e assinar URL para ele daria 404 no meio do download.
export async function findCorrenteDoCiclo(licencaId: string, ciclo: string) {
  return prisma.backup.findMany({
    where:   { licencaId, ciclo, status: 'CONFIRMADO' },
    orderBy: { sequencia: 'asc' },
  })
}

/// O envio em andamento desta licença, se houver — é o LOCK entre as máquinas da
/// loja.
///
/// O ERP dispara no login, então três estações abrindo às 8h tentariam três
/// backups do mesmo cliente, escrevendo na mesma chave e queimando a cota antes
/// das 9h. Fazer esse lock na rede local seria frágil (se a máquina servidor está
/// desligada, não há quem arbitre); aqui o estado já existe.
///
/// Só conta emissão dentro do TTL: passado ele a URL não vale mais, o upload não
/// tem como concluir, e segurar o lock indefinidamente deixaria a loja inteira
/// sem backup por causa de uma máquina que travou.
export async function findEnvioPendente(licencaId: string, minutosTtl: number) {
  const limite = new Date(Date.now() - minutosTtl * 60_000)
  return prisma.backup.findFirst({
    where:   { licencaId, status: 'EMITIDO', emitidoEm: { gte: limite } },
    orderBy: { emitidoEm: 'desc' },
  })
}

/// Próxima posição na corrente do ciclo. O FULL ocupa a 0; os fragmentos seguem.
///
/// Conta linhas EMITIDAS também, e não só confirmadas: duas autorizações
/// concorrentes que recebessem a mesma sequência produziriam duas ordens de
/// extração possíveis para o mesmo ciclo — e uma delas restaura errado.
export async function proximaSequencia(licencaId: string, ciclo: string): Promise<number> {
  const maior = await prisma.backup.aggregate({
    where: { licencaId, ciclo, status: { not: 'FALHOU' } },
    _max:  { sequencia: true },
  })

  return (maior._max.sequencia ?? -1) + 1
}

/// Ciclos que já podem sair da nuvem, com as chaves a apagar.
///
/// A regra de segurança está inteira na consulta: só entram linhas de ciclos
/// ANTERIORES a um ciclo que tem FULL confirmado. Enquanto o full novo não
/// confirmar, nada é elegível — é o que impede o caso em que o full da segunda
/// falha, a limpeza roda assim mesmo e o cliente fica com zero backup.
///
/// `manterCiclos` é quantos ciclos completos preservar além do corrente.
export async function findCiclosSuperados(manterCiclos = 1) {
  const fulls = await prisma.backup.findMany({
    where:    { tipo: 'FULL', status: 'CONFIRMADO' },
    distinct: ['licencaId'],
    orderBy:  { ciclo: 'desc' },
    select:   { licencaId: true, ciclo: true },
  })

  const superados: { licencaId: string; ciclo: string; ids: string[]; chaves: string[] }[] = []

  for (const full of fulls) {
    // Ciclos distintos desta licença que são mais antigos que o do full atual.
    const antigos = await prisma.backup.findMany({
      where:    { licencaId: full.licencaId, ciclo: { lt: full.ciclo }, status: 'CONFIRMADO' },
      distinct: ['ciclo'],
      orderBy:  { ciclo: 'desc' },
      select:   { ciclo: true },
    })

    for (const { ciclo } of antigos.slice(manterCiclos)) {
      const linhas = await prisma.backup.findMany({
        where:  { licencaId: full.licencaId, ciclo, status: 'CONFIRMADO' },
        select: { id: true, chaveS3: true },
      })

      if (linhas.length > 0)
        superados.push({
          licencaId: full.licencaId,
          ciclo,
          ids:    linhas.map(l => l.id),
          chaves: linhas.map(l => l.chaveS3),
        })
    }
  }

  return superados
}

/// Tudo que o inventário afirma existir na nuvem, para a varredura de verificação
/// conferir objeto por objeto.
///
/// Existe porque o full semanal tinha uma segunda função que ninguém tinha
/// nomeado: re-baseline. Elo corrompido ou sumido era curado pelo full seguinte,
/// em silêncio. Sem isso, um buraco na corrente só apareceria na restauração —
/// no pior dia possível para descobrir.
export async function findBackupsConfirmadosParaVerificar() {
  return prisma.backup.findMany({
    where:   { status: 'CONFIRMADO' },
    orderBy: [{ licencaId: 'asc' }, { ciclo: 'asc' }, { sequencia: 'asc' }],
    select: {
      id: true, licencaId: true, ciclo: true, sequencia: true,
      tipo: true, chaveS3: true, tamanhoRealBytes: true,
    },
  })
}

/// Marca linhas como removidas depois que o objeto saiu do bucket.
///
/// A linha NÃO é apagada: sem ela a restauração tentaria assinar URL para um
/// objeto que não existe mais, e o histórico perderia o registro de que aquele
/// ciclo existiu.
export async function marcarBackupsRemovidos(ids: string[]) {
  return prisma.backup.updateMany({
    where: { id: { in: ids } },
    data:  { status: 'REMOVIDO' },
  })
}

export async function findBackupsRecentes(licencaId: string, limite = 30) {
  return prisma.backup.findMany({
    where:   { licencaId },
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
  const [licencas, fulls, fragmentos, falhas] = await Promise.all([
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

    // O FULL mais recente de cada licença — a base da cópia que existe na nuvem.
    // `distinct` com `orderBy` desc devolve a linha mais nova de cada licença.
    prisma.backup.findMany({
      where:    { status: 'CONFIRMADO', tipo: 'FULL' },
      distinct: ['licencaId'],
      orderBy:  { emitidoEm: 'desc' },
      select: {
        licencaId:        true,
        ciclo:            true,
        tamanhoBytes:     true,
        tamanhoRealBytes: true,
        confirmadoEm:     true,
        emitidoEm:        true,
        hwid:             true,
        chaveS3:          true,
      },
    }),

    // Os fragmentos entram um a um, para o service agregar por licença e ciclo.
    //
    // Não dá para usar groupBy: a tela precisa da SEQUÊNCIA para mostrar a
    // corrente na ordem em que seria restaurada, e um total agregado esconderia
    // exatamente o que importa olhar — se falta um elo no meio.
    prisma.backup.findMany({
      where:   { status: 'CONFIRMADO', tipo: 'FRAGMENTO' },
      orderBy: [{ ciclo: 'desc' }, { sequencia: 'asc' }],
      select: {
        licencaId:        true,
        ciclo:            true,
        sequencia:        true,
        tamanhoBytes:     true,
        tamanhoRealBytes: true,
        confirmadoEm:     true,
        emitidoEm:        true,
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

  return { licencas, fulls, fragmentos, falhas }
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
/// Quantos eventos a poda removeria. Existe para o modo simulação poder
/// informar o número sem apagar nada.
export async function contarEventosAntigosDeBackup(dias: number) {
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
  return prisma.backup.count({ where: { emitidoEm: { lt: limite } } })
}

export async function podarEventosDeBackup(dias: number) {
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
  return prisma.backup.deleteMany({ where: { emitidoEm: { lt: limite } } })
}
