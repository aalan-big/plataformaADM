import { Injectable, NotFoundException } from '@nestjs/common'
import {
  findEnderecosByCliente,
  findEnderecoById,
  createEndereco,
  updateEndereco,
  deleteEndereco,
  findClienteById,
} from '@startbig/database'
import type { CriarEnderecoInput, EditarEnderecoInput } from '@startbig/schemas'

@Injectable()
export class EnderecoService {

  async listar(clienteId: string) {
    const cliente = await findClienteById(clienteId)
    if (!cliente) throw new NotFoundException('Cliente não encontrado.')
    return findEnderecosByCliente(clienteId)
  }

  async adicionar(dados: CriarEnderecoInput) {
    const cliente = await findClienteById(dados.clienteId)
    if (!cliente) throw new NotFoundException('Cliente não encontrado.')
    return createEndereco(dados)
  }

  async editar(id: string, dados: EditarEnderecoInput) {
    const end = await findEnderecoById(id)
    if (!end) throw new NotFoundException('Endereço não encontrado.')
    return updateEndereco(id, dados)
  }

  async remover(id: string) {
    const end = await findEnderecoById(id)
    if (!end) throw new NotFoundException('Endereço não encontrado.')
    return deleteEndereco(id)
  }
}
