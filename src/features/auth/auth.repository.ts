/**
 * FUNÇÃO: findUserByEmail
 * OBJETIVO: Localizar um registro único na tabela 'usuarios' usando o e-mail.
 * USO COMUM: No Login (para verificar se o e-mail existe) e no Cadastro 
 * (para evitar que dois clientes usem o mesmo e-mail).
 */
import prisma from '@/lib/prisma'

export async function findUserByEmail(email: string) {
  return await prisma.usuario.findUnique({
    // O 'where' diz ao banco: "Procure apenas onde a coluna email seja igual ao que recebi"
    where: { email },
  })
}
