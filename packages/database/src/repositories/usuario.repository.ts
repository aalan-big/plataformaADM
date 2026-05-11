import prisma from '../client'

export async function findUserByEmail(email: string) {
  return await prisma.usuario.findUnique({ where: { email } })
}

export async function findUserById(id: string) {
  return await prisma.usuario.findUnique({ where: { id } })
}

export async function saveUser(data: {
  nome: string
  email: string
  senha: string
  tipoUsuario?: string
}) {
  return await prisma.usuario.create({ data })
}

export async function getAllUsers() {
  return await prisma.usuario.findMany({
    select: {
      id: true,
      nome: true,
      email: true,
      tipoUsuario: true,
      ativo: true,
      criadoEm: true,
    },
  })
}

export async function updateUser(id: string, data: Partial<{
  nome: string
  email: string
  senha: string
  tipoUsuario: string
  ativo: boolean
}>) {
  return await prisma.usuario.update({ where: { id }, data })
}

export async function deleteUser(id: string) {
  return await prisma.usuario.delete({ where: { id } })
}
