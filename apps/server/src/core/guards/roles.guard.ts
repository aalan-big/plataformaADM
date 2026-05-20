/**
 * ============================================================================
 * NOME DO ARQUIVO: roles.guard.ts
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
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { PUBLIC_KEY } from '../decorators/public.decorator'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // Se nenhuma role foi especificada e não é pública, o padrão seguro é exigir ADMIN
    const rolesToCheck = requiredRoles && requiredRoles.length > 0 ? requiredRoles : ['ADMIN']

    const { user } = context.switchToHttp().getRequest()
    
    if (!user || !user.role) {
      throw new ForbiddenException('Acesso negado: Perfil de usuário não identificado.')
    }

    const hasRole = rolesToCheck.includes(user.role)
    if (!hasRole) {
      throw new ForbiddenException('Acesso negado: Você não possui permissão para acessar este recurso.')
    }

    return true
  }
}
