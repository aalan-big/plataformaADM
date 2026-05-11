import prisma from '../client'

export async function findUserByEmail(email: string) {
  return await prisma.usuario.findUnique({
    where: { email },
  })
}
