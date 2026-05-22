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

  if (cliente.tipo !== 'PJ') throw new Error('Cliente não é Pessoa Jurídica.')

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
