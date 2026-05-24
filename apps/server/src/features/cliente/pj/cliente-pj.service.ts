/**
 * ============================================================================
 * NOME DO ARQUIVO: cliente-pj.service.ts
 * MÓDULO: CLIENTE
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de CLIENTE. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { findClientePJByCnpj, createClientePJ, updateClientePJ, findClienteById, findClienteByEmail } from '@startbig/database'
import type { CriarClientePJInput, EditarClientePJInput } from '@startbig/schemas'

export async function criarClientePJ(dados: CriarClientePJInput) {
  const existeCnpj = await findClientePJByCnpj(dados.cnpj)
  if (existeCnpj) throw new Error('CNPJ já cadastrado.')

  const existeEmail = await findClienteByEmail(dados.email)
  if (existeEmail) throw new Error('E-mail já cadastrado em outro cliente.')

  return createClientePJ(dados)
}

export async function editarClientePJ(clienteId: string, dados: EditarClientePJInput) {
  const cliente = await findClienteById(clienteId)
  if (!cliente) throw new Error('Cliente não encontrado.')

  if (!cliente.pj) throw new Error('Cliente não é Pessoa Jurídica.')

  const usuariosAtivos = (cliente as any).usuariosAtivos ?? 0
  if (dados.licencas !== undefined && dados.licencas < usuariosAtivos) {
    throw new Error(
      `Não é possível reduzir para ${dados.licencas} licença(s) — o cliente possui ${usuariosAtivos} usuário(s) ativo(s).`
    )
  }

  if (dados.cnpj) {
    const existeCnpj = await findClientePJByCnpj(dados.cnpj)
    if (existeCnpj && existeCnpj.clienteId !== clienteId) throw new Error('CNPJ já cadastrado em outro cliente.')
  }

  if (dados.email) {
    const existeEmail = await findClienteByEmail(dados.email, clienteId)
    if (existeEmail) throw new Error('E-mail já cadastrado em outro cliente.')
  }

  return updateClientePJ(clienteId, dados)
}
