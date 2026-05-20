/**
 * ============================================================================
 * NOME DO ARQUIVO: usuario.service.ts
 * MÓDULO: USUARIO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de USUARIO. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { Injectable, BadRequestException } from '@nestjs/common'
import bcrypt from 'bcryptjs'
import { findUserByEmail, saveUser, getAllUsers, updateUser, deleteUser } from '@startbig/database'
import { CARGO_PADRAO } from '@startbig/schemas'
import type { CriarUsuarioInput, EditarUsuarioInput } from '@startbig/schemas'

@Injectable()
export class UsuarioService {

  async listar() {
    return getAllUsers()
  }

  async criar(input: CriarUsuarioInput) {
    const existing = await findUserByEmail(input.email)
    if (existing) throw new BadRequestException('Este e-mail já está sendo utilizado por outro administrador.')

    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(input.senha, salt)

    const newUser = await saveUser({
      nome: input.nome,
      email: input.email,
      senha: hashedPassword,
      tipoUsuario: input.cargo ?? CARGO_PADRAO,
    })

    const { senha: _, ...user } = newUser
    return user
  }

  async editar(id: string, data: EditarUsuarioInput) {
    if (data.email) {
      const existing = await findUserByEmail(data.email)
      if (existing && existing.id !== id) {
        throw new BadRequestException('Este e-mail já está sendo utilizado por outro administrador.')
      }
    }

    const updateData: Parameters<typeof updateUser>[1] = {
      nome: data.nome,
      email: data.email,
      tipoUsuario: data.cargo,
    }

    if (data.senha) {
      const salt = await bcrypt.genSalt(10)
      updateData.senha = await bcrypt.hash(data.senha, salt)
    }

    const updated = await updateUser(id, updateData)
    const { senha: _, ...user } = updated
    return user
  }

  async deletar(id: string) {
    return deleteUser(id)
  }
}
