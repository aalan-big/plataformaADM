/**
 * ARQUIVO: Service de Usuário
 * POSIÇÃO: Camada de Negócio (Business Logic Layer)
 * FUNÇÃO: Contém a "inteligência" do sistema. Valida regras de negócio,
 * faz criptografia e garante a segurança dos dados.
 */

import bcrypt from 'bcryptjs'
import {
  findUserByEmail,
  saveUser,
  getAllUsers,
  updateUser,
  deleteUser,
} from './usuario.repository'
import { CARGO_PADRAO } from './usuario.schema'
import type { CriarUsuarioInput, EditarUsuarioInput } from './usuario.schema'

// CRIAÇÃO: Lógica para cadastrar um novo administrador
export async function criarUsuario(input: CriarUsuarioInput) {

  // 1. Regra de Negócio: Não pode ter dois usuários com o mesmo e-mail
  const existing = await findUserByEmail(input.email)
  if (existing) {
    throw new Error('Este e-mail já está sendo utilizado por outro administrador.')
  }

  // 2. Segurança: Transforma a senha em texto puro num Hash "embaralhado"
  // É aqui que o seu '123456' vira aquele código longo que vimos no Supabase
  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(input.senha, salt)

  // 3. Persistência: Chama o Repository para salvar de fato no Postgres
  const newUser = await saveUser({
    nome: input.nome,
    email: input.email,
    senha: hashedPassword,
    cargo: input.cargo ?? CARGO_PADRAO,
  })

  // 4. Limpeza: Remove a senha do objeto antes de enviar para o Frontend
  // Segurança máxima: nem o programador vê a senha de volta aqui
  const { senha: _, ...userWithoutPassword } = newUser
  return userWithoutPassword
}

export { criarUsuario as createUserService }

// LISTAGEM: Apenas repassa a busca do Repository
export async function listarUsuarios() {
  return await getAllUsers()
}

// EDIÇÃO: Lógica para atualizar dados
export async function editarUsuario(id: string, data: EditarUsuarioInput) {
  if (data.email) {
    // Verifica se o novo e-mail já pertence a outra pessoa
    const existing = await findUserByEmail(data.email)
    if (existing && existing.id !== id) {
      throw new Error('Este e-mail já está sendo utilizado por outro administrador.')
    }
  }

  const updateData: Parameters<typeof updateUser>[1] = {
    nome: data.nome,
    email: data.email,
    cargo: data.cargo,
  }

  // Se o usuário estiver mudando a senha, criptografa a nova
  if (data.senha) {
    const salt = await bcrypt.genSalt(10)
    updateData.senha = await bcrypt.hash(data.senha, salt)
  }

  const updated = await updateUser(id, updateData)
  const { senha: _, ...userWithoutPassword } = updated
  return userWithoutPassword
}

// EXCLUSÃO: Chama o comando de deletar
export async function deletarUsuario(id: string) {
  return await deleteUser(id)
}
