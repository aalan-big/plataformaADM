/*
 * ARQUIVO: Repository de Usuários
 * POSIÇÃO: Camada de Dados (Data Access Layer)
 * FUNÇÃO: Este arquivo é o único que "toca" na tabela 'usuario' do banco de dados.
 * Se amanhã você mudar o banco de novo, só precisa mexer aqui.
 */
import prisma from '@/lib/prisma'

// R: READ - Busca um usuário específico pelo e-mail (usado muito no Login)
export async function findUserByEmail(email: string) {
  return await prisma.usuario.findUnique({ where: { email } })
}

// R: READ - Busca um usuário pelo ID (UUID/String) para perfis ou detalhes
export async function findUserById(id: string) {
  return await prisma.usuario.findUnique({ where: { id } })
}

// C: CREATE - Grava um novo usuário no Postgres (Cadastro)
export async function saveUser(data: {
  nome: string
  email: string
  senha: string
  cargo: string
}) {
  return await prisma.usuario.create({ data })
}

// R: READ - Lista todos os usuários cadastrados (usado no painel administrativo)
// Note que usamos o 'select' para não trazer a senha por segurança
export async function getAllUsers() {
  return await prisma.usuario.findMany({
    select: {
      id: true,
      nome: true,
      email: true,
      cargo: true,
      ativo: true,
      criadoEm: true,
    },
  })
}

// U: UPDATE - Altera os dados de um usuário existente (ex: mudar senha ou desativar)
export async function updateUser(id: string, data: Partial<{
  nome: string
  email: string
  senha: string
  cargo: string
  ativo: boolean
}>) {
  return await prisma.usuario.update({ where: { id }, data })
}

// D: DELETE - Remove o usuário do banco (Cuidado: ação irreversível!)
export async function deleteUser(id: string) {
  return await prisma.usuario.delete({ where: { id } })
}
