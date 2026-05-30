import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { DispositivoService } from '../../features/dispositivos/dispositivo.service'
import jwt from 'jsonwebtoken'

@Injectable()
export class ErpLicencaGuard implements CanActivate {
  constructor(private readonly dispositivoService: DispositivoService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const authHeader: string | undefined = request.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de licença não fornecido.')
    }

    const token = authHeader.slice(7)
    try {
      const publicKey = this.dispositivoService.getPublicKey()
      const payload   = jwt.verify(token, publicKey, { algorithms: ['RS256'] })
      request.erp     = payload
      return true
    } catch {
      throw new UnauthorizedException('Token de licença inválido ou expirado.')
    }
  }
}
