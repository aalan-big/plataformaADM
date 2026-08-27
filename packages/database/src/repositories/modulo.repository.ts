import { prisma } from '../client'

/**
 * Módulos fiscais, um por tipo de documento.
 *
 * São separados porque servem clientes diferentes: NF-e e NFC-e são de quem
 * vende mercadoria, NFS-e é de quem vende serviço. Um módulo "FISCAL" único
 * obrigaria a entregar os três a quem contratasse qualquer um deles.
 *
 * O valor de cada constante é, ao mesmo tempo, o `identificador` do módulo no
 * catálogo e o `tipoDocumento` no contador de cota — de propósito: é o que faz
 * "quanto pode emitir" e "o que pode emitir" nunca saírem de sincronia.
 *
 * IMUTÁVEIS depois de irem para produção: viajam dentro do JWT das licenças.
 */
export const MODULO_NFE  = 'NFE'
export const MODULO_NFCE = 'NFCE'
export const MODULO_NFSE = 'NFSE'

/** Tipos de documento aceitos pelo contador. */
export const TIPOS_DOCUMENTO_FISCAL = [MODULO_NFE, MODULO_NFCE, MODULO_NFSE] as const
export type TipoDocumentoFiscal = (typeof TIPOS_DOCUMENTO_FISCAL)[number]

export async function listarModulos(incluirInativos = false) {
  return prisma.modulo.findMany({
    where:   incluirInativos ? {} : { ativo: true },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  })
}

export async function findModuloPorIdentificador(identificador: string) {
  return prisma.modulo.findUnique({ where: { identificador } })
}

export async function findModulosDoPlano(planoId: string) {
  return prisma.planoModulo.findMany({
    where:   { planoId },
    include: { modulo: true },
  })
}

/**
 * Substitui o conjunto de módulos de um plano.
 *
 * Apaga e recria dentro de uma transação em vez de comparar item a item: o
 * conjunto é pequeno, o formulário sempre manda o estado completo, e um upsert
 * seletivo deixaria vínculo órfão quando o admin desmarca uma caixa.
 */
export async function definirModulosDoPlano(
  planoId: string,
  modulos: { moduloId: string; cotaMensal?: number | null }[],
) {
  return prisma.$transaction([
    prisma.planoModulo.deleteMany({ where: { planoId } }),
    ...(modulos.length > 0
      ? [prisma.planoModulo.createMany({
          data: modulos.map(m => ({
            planoId,
            moduloId:   m.moduloId,
            cotaMensal: m.cotaMensal ?? null,
          })),
        })]
      : []),
  ])
}

/**
 * Cota mensal de um módulo para uma licença, resolvida na ordem que a licença
 * enxerga: extra contratado vence o que o plano inclui.
 *
 * Ausência em todo lugar devolve `null`, que significa SEM TETO. É o padrão de
 * propósito — enquanto o catálogo não estiver configurado, ninguém é bloqueado
 * por uma cota que nunca foi definida.
 */
export async function resolverCotaModulo(licencaId: string, identificador: string) {
  const licenca = await prisma.licenca.findUnique({
    where:  { id: licencaId },
    select: { planoId: true },
  })
  if (!licenca) return null

  const extra = await prisma.licencaModuloExtra.findFirst({
    where: {
      licencaId,
      modulo: { identificador },
      OR: [{ dataVencimento: null }, { dataVencimento: { gt: new Date() } }],
    },
    select: { cotaMensal: true },
  })
  if (extra) return extra.cotaMensal

  const doPlano = await prisma.planoModulo.findFirst({
    where:  { planoId: licenca.planoId, modulo: { identificador } },
    select: { cotaMensal: true },
  })
  return doPlano?.cotaMensal ?? null
}

/**
 * Panorama dos módulos de uma licença, separados por ORIGEM.
 *
 * A separação é o ponto: o painel precisa distinguir "veio do plano" de "vendi à
 * parte", senão o admin desmarca o errado achando que está tirando um extra e na
 * verdade não pode — o que vem do plano só muda mexendo no plano, e mexer no
 * plano afeta todo mundo que o contratou.
 */
export async function modulosDaLicencaDetalhado(licencaId: string) {
  const licenca = await prisma.licenca.findUnique({
    where:  { id: licencaId },
    select: {
      planoId: true,
      plano:   { select: { nome: true } },
    },
  })
  if (!licenca) return null

  const [doPlano, extras, catalogo] = await Promise.all([
    prisma.planoModulo.findMany({
      where:   { planoId: licenca.planoId },
      include: { modulo: true },
    }),
    prisma.licencaModuloExtra.findMany({
      where:   { licencaId },
      include: { modulo: true },
      orderBy: { dataContratacao: 'desc' },
    }),
    listarModulos(true),
  ])

  const agora = new Date()
  return {
    planoNome: licenca.plano?.nome ?? null,
    doPlano: doPlano.map(pm => ({
      identificador: pm.modulo.identificador,
      nome:          pm.modulo.nome,
      ativo:         pm.modulo.ativo,
      cotaMensal:    pm.cotaMensal,
    })),
    extras: extras.map(e => ({
      identificador:   e.modulo.identificador,
      nome:            e.modulo.nome,
      ativo:           e.modulo.ativo,
      cotaMensal:      e.cotaMensal,
      cortesia:        e.cortesia,
      valorCobrado:    e.valorCobrado,
      dataContratacao: e.dataContratacao,
      dataVencimento:  e.dataVencimento,
      observacao:      e.observacao,
      // Extra vencido continua na lista, marcado: sumir da tela esconderia do
      // admin por que o cliente perdeu acesso a um módulo que ele lembra de ter
      // liberado.
      vencido:         !!e.dataVencimento && e.dataVencimento <= agora,
    })),
    catalogo: catalogo.map(m => ({
      identificador: m.identificador,
      nome:          m.nome,
      descricao:     m.descricao,
      ativo:         m.ativo,
      // Vai junto para o formulário já sugerir o valor cadastrado em Módulos —
      // digitar o preço de cabeça a cada concessão é como o valor cobrado acaba
      // divergindo da tabela sem ninguém perceber.
      precoMensal:   m.precoMensal,
    })),
  }
}

export async function concederModuloExtra(licencaId: string, dados: {
  identificador:   string
  cortesia?:       boolean
  dataVencimento?: Date | null
  valorCobrado?:   number | null
  cotaMensal?:     number | null
  observacao?:     string | null
}) {
  const modulo = await findModuloPorIdentificador(dados.identificador)
  if (!modulo) return null

  const comuns = {
    cortesia:       dados.cortesia ?? false,
    dataVencimento: dados.dataVencimento ?? null,
    valorCobrado:   dados.valorCobrado ?? null,
    cotaMensal:     dados.cotaMensal ?? null,
    observacao:     dados.observacao ?? null,
  }

  // Upsert e não create: conceder de novo o mesmo módulo é renovar/corrigir o
  // que já existe, não um erro de chave duplicada na cara do admin.
  return prisma.licencaModuloExtra.upsert({
    where:  { licencaId_moduloId: { licencaId, moduloId: modulo.id } },
    update: comuns,
    create: { licencaId, moduloId: modulo.id, ...comuns },
    include: { modulo: true },
  })
}

export async function revogarModuloExtra(licencaId: string, identificador: string) {
  const modulo = await findModuloPorIdentificador(identificador)
  if (!modulo) return null

  return prisma.licencaModuloExtra.deleteMany({
    where: { licencaId, moduloId: modulo.id },
  })
}

export async function atualizarModulo(identificador: string, dados: {
  nome?:        string
  descricao?:   string | null
  icone?:       string | null
  ativo?:       boolean
  ordem?:       number
  precoMensal?: number | null
}) {
  const modulo = await findModuloPorIdentificador(identificador)
  if (!modulo) return null

  // `identificador` fora do update de propósito — ver comentário no schema.
  return prisma.modulo.update({ where: { id: modulo.id }, data: dados })
}

export async function findModuloPorId(id: string) {
  return prisma.modulo.findUnique({ where: { id } })
}

/** Concessão avulsa vigente ou vencida deste módulo, se existir. */
export async function findModuloExtraDaLicenca(licencaId: string, moduloId: string) {
  return prisma.licencaModuloExtra.findUnique({
    where: { licencaId_moduloId: { licencaId, moduloId } },
  })
}

/**
 * Catálogo com o que a tela de administração precisa para DECIDIR, não só para
 * editar: em quais planos o módulo está e quantas licenças o receberam à parte.
 *
 * Sem isso, a pergunta que o admin faz ao abrir a tela — "posso desativar este
 * módulo?" — não tem resposta na tela, e ele desativaria às cegas algo que dois
 * planos incluem.
 */
export async function listarModulosDetalhado() {
  const modulos = await prisma.modulo.findMany({
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    include: {
      planos: { select: { cotaMensal: true, plano: { select: { nome: true } } } },
    },
  })

  const agora = new Date()
  const avulsas = await prisma.licencaModuloExtra.groupBy({
    by:    ['moduloId'],
    where: { OR: [{ dataVencimento: null }, { dataVencimento: { gt: agora } }] },
    _count: true,
  })
  const porModulo = new Map(avulsas.map(a => [a.moduloId, a._count]))

  return modulos.map(m => ({
    id:            m.id,
    identificador: m.identificador,
    nome:          m.nome,
    descricao:     m.descricao,
    icone:         m.icone,
    ativo:         m.ativo,
    ordem:         m.ordem,
    precoMensal:   m.precoMensal,
    planos:        m.planos.map(p => ({ nome: p.plano.nome, cotaMensal: p.cotaMensal })),
    // Só concessões vigentes: contar as vencidas infla o número e sugere um uso
    // que já não existe.
    licencasAvulsas: porModulo.get(m.id) ?? 0,
  }))
}
