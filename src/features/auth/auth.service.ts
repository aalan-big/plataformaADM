/**
 * ARQUIVO: Service de Autenticação
 * POSIÇÃO: Camada de Negócio (Auth Service)
 * FUNÇÃO: Validar a senha e gerar o Token de acesso (JWT).
 * É aqui que o sistema decide se "abre a porta" para o usuário ou não.
 */
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { findUserByEmail } from './auth.repository'
import type { LoginInput } from './auth.schema'

export async function authenticateUser({ email, senha }: LoginInput) {
  // 1. BUSCA: Chama o Repository para ver se esse e-mail existe no banco
  const user = await findUserByEmail(email)

  // Se o usuário não existir, barramos logo aqui
  if (!user) {
    throw new Error('Credenciais inválidas.')
  }

  // 2. COMPARAÇÃO DE SENHA: O 'bcrypt.compare' pega a senha digitada 
  // e compara com o Hash embaralhado que está no banco (Supabase).
  const isPasswordValid = await bcrypt.compare(senha, user.senha)

  if (!isPasswordValid) {
    throw new Error('Credenciais inválidas.')
  }

  // 3. SEGURANÇA: Pega a sua chave secreta do arquivo .env
  const secretKey = process.env.JWT_SECRET || 'chave-secreta-de-desenvolvimento'

  // 4. GERAÇÃO DO TOKEN (JWT): Cria um "crachá digital" que o usuário
  // vai carregar por 8 horas. Esse crachá contém o ID e o e-mail dele.
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    secretKey,
    { expiresIn: '8h' }
  )

  // 5. RETORNO: Devolve o crachá (token) e os dados básicos do usuário
  return {
    token,
    user: { id: user.id, email: user.email },
  }
}
