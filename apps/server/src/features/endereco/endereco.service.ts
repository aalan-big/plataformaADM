/**
 * ============================================================================
 * NOME DO ARQUIVO: endereco.service.ts
 * MÓDULO: ENDERECO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de ENDERECO. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
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
