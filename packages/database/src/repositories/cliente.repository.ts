import { prisma } from '../client'

/**
 * Campos da config fiscal que podem sair do banco.
 *
 * `focusEmpresaToken` fica DE FORA de propósito, e a lista é explícita para que
 * um campo novo no schema não entre aqui sozinho. Aquele token emite nota no
 * CNPJ do cliente direto na Focus, sem passar por esta API — quem o tiver não
 * precisa de mais nada. Como este include serve também a `findAllClientes`, ele
 * sairia no JSON da tela de listagem, para todos os clientes de uma vez.
 *
 * Para saber se o token existe sem transportá-lo, use `tokenConfigurado`,
 * devolvido por `findClienteById`.
 */
const selectConfiguracaoFiscal = {
  id:                    true,
  cnpj:                  true,
  razaoSocial:           true,
  inscricaoEstadual:     true,
  ambiente:              true,
  focusEmpresaId:        true,
  certificadoNome:       true,
  certificadoVencimento: true,
  certificadoStatus:     true,
  criadoEm:              true,
  atualizadoEm:          true,
}

const includeAll = {
  pf: true,
  pj: true,
  enderecos: true,
  configuracaoFiscal: { select: selectConfiguracaoFiscal },
}

export async function findAllClientes() {
  return prisma.cliente.findMany({
    where: { ativo: true },
    include: includeAll,
    orderBy: { criadoEm: 'desc' },
  })
}

export async function findClienteById(id: string) {
  const cliente = await prisma.cliente.findUnique({
    where: { id },
    include: includeAll,
  })
  if (!cliente?.configuracaoFiscal) return cliente

  /**
   * O painel só precisa saber SE o token existe, para mostrar "configurado" ou
   * "pendente". Um count responde isso sem que o valor saia do banco — é uma
   * consulta a mais, mas só na abertura do perfil de um cliente, nunca na lista.
   */
  const comToken = await prisma.empresaFiscalConfig.count({
    where: { clienteId: id, focusEmpresaToken: { not: null } },
  })

  return {
    ...cliente,
    configuracaoFiscal: { ...cliente.configuracaoFiscal, tokenConfigurado: comToken > 0 },
  }
}

export async function searchClientes(termo: string) {
  const t = termo.trim()
  return prisma.cliente.findMany({
    where: {
      ativo: true,
      OR: [
        { id:    { contains: t, mode: 'insensitive' } },
        { email: { contains: t, mode: 'insensitive' } },
        { pf: { nomeCompleto: { contains: t, mode: 'insensitive' } } },
        { pf: { cpf:          { contains: t, mode: 'insensitive' } } },
        { pj: { razaoSocial:  { contains: t, mode: 'insensitive' } } },
        { pj: { nomeFantasia: { contains: t, mode: 'insensitive' } } },
        { pj: { cnpj:         { contains: t, mode: 'insensitive' } } },
        { pj: { responsavel:  { contains: t, mode: 'insensitive' } } },
      ],
    },
    include: includeAll,
    orderBy: { criadoEm: 'desc' },
  })
}

export async function findClienteByEmail(email: string, excluirId?: string) {
  return prisma.cliente.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
  })
}

/**
 * Guarda o id do cliente dentro do Asaas depois da primeira cobrança PIX.
 *
 * Sem isto, cada PIX criaria um cadastro novo lá: o mesmo cliente apareceria
 * várias vezes no painel do gateway e o histórico de pagamentos dele nasceria
 * partido, com uma parte em cada cadastro.
 */
export async function salvarAsaasCustomerId(clienteId: string, asaasCustomerId: string) {
  return prisma.cliente.update({
    where: { id: clienteId },
    data:  { asaasCustomerId },
  })
}
