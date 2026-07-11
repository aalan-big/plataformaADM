/**
 * ============================================================================
 * NOME DO ARQUIVO: auth.guard.ts
 * MÓDULO: CORE/GERAL
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Funciona como um "Segurança de Porta" (Middleware de Proteção). Ele barra
 * requisições que não cumprem os requisitos (ex: usuário sem login, ou sem a role certa).
 * 
 * O QUE ELE CONTÉM:
 * - Lógica de verificação de Tokens JWT.
 * - Lógica de verificação de Permissões (RBAC).
 * ============================================================================
 */
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import jwt from 'jsonwebtoken'
import { PUBLIC_KEY } from '../decorators/public.decorator'
import { getJwtSecret } from '../config/secrets'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest()
    const authHeader: string | undefined = request.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token não fornecido.')
    }

    const token = authHeader.slice(7)

    try {
      request.user = jwt.verify(token, getJwtSecret())
      return true
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado.')
    }
  }
}
