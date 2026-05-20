/**
 * ============================================================================
 * NOME DO ARQUIVO: auth.service.ts
 * MÓDULO: AUTH
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de AUTH. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { Injectable, UnauthorizedException } from '@nestjs/common'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { findUserByEmail } from '@startbig/database'

@Injectable()
export class AuthService {
  async login(email: string, senha: string) {
    const user = await findUserByEmail(email)
    if (!user) throw new UnauthorizedException('Credenciais inválidas.')

    const valid = await bcrypt.compare(senha, user.senha)
    if (!valid) throw new UnauthorizedException('Credenciais inválidas.')

    const secret = process.env.JWT_SECRET ?? 'chave-secreta-de-desenvolvimento'
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.tipoUsuario }, secret, { expiresIn: '8h' })

    return { token, user: { id: user.id, nome: user.nome, email: user.email, tipoUsuario: user.tipoUsuario } }
  }
}
