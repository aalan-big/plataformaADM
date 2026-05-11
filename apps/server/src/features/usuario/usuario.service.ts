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
      cargo: input.cargo ?? CARGO_PADRAO,
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
      cargo: data.cargo,
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
