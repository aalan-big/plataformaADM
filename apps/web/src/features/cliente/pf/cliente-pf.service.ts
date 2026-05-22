import { findClientePFByCpf, createClientePF, updateClientePF, findClienteById, findClienteByEmail } from '@startbig/database'
import type { CriarClientePFInput, EditarClientePFInput } from '@startbig/schemas'

export async function criarClientePF(dados: CriarClientePFInput) {
  const existeCpf = await findClientePFByCpf(dados.cpf)
  if (existeCpf) throw new Error('CPF já cadastrado.')

  const existeEmail = await findClienteByEmail(dados.email)
  if (existeEmail) throw new Error('E-mail já cadastrado em outro cliente.')

  return createClientePF(dados)
}

export async function editarClientePF(clienteId: string, dados: EditarClientePFInput) {
  const cliente = await findClienteById(clienteId)
  if (!cliente) throw new Error('Cliente não encontrado.')

  if (cliente.tipo !== 'PF') throw new Error('Cliente não é Pessoa Física.')

  if (dados.cpf) {
    const existeCpf = await findClientePFByCpf(dados.cpf)
    if (existeCpf && existeCpf.clienteId !== clienteId) throw new Error('CPF já cadastrado em outro cliente.')
  }

  if (dados.email) {
    const existeEmail = await findClienteByEmail(dados.email, clienteId)
    if (existeEmail) throw new Error('E-mail já cadastrado em outro cliente.')
  }

  return updateClientePF(clienteId, dados)
}
