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
    const token = jwt.sign({ userId: user.id, email: user.email }, secret, { expiresIn: '8h' })

    return { token, user: { id: user.id, nome: user.nome, email: user.email } }
  }
}
