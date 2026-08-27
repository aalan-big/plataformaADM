import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { MODULO_KEY } from '../decorators/requer-modulo.decorator'

/**
 * Interruptor da trava por módulo.
 *
 * Desligado, o guard não bloqueia nada — apenas registra no log o que TERIA
 * bloqueado. É assim que se descobre, sem derrubar cliente, se a configuração de
 * módulos do painel bate com o que a base realmente usa: liga em produção, lê o
 * log por alguns dias, e só então vira `true`.
 *
 * Voltar atrás é mudar a variável e reiniciar o pm2 — sem deploy, sem rollback
 * de código, sem esperar build.
 */
const ENFORCE = process.env.ENTITLEMENTS_ENFORCE === 'true'

@Injectable()
export class ModuloGuard implements CanActivate {
  private readonly logger = new Logger(ModuloGuard.name)

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requerido = this.reflector.getAllAndOverride<string | undefined>(MODULO_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // Rota que ninguém marcou não é assunto deste guard.
    if (!requerido) return true

    const request = context.switchToHttp().getRequest()
    const erp     = request.erp as { licencaId?: string; modulos?: string[] } | undefined

    /**
     * Sem `erp` no request, o ErpLicencaGuard não rodou — ou não está aplicado
     * nesta rota, ou a ordem dos guards mudou. Não é o nosso papel decidir
     * autenticação, então deixamos passar e gritamos no log: bloquear aqui
     * mascararia um erro de configuração como se fosse falta de módulo.
     */
    if (!erp) {
      this.logger.error(`[modulo] rota exige ${requerido} mas não há licença no request — ErpLicencaGuard não rodou antes deste guard.`)
      return true
    }

    /**
     * TOKEN LEGADO: emitido antes de a claim `modulos` existir.
     *
     * O JWT vive até 7 dias. No dia em que a trava liga, boa parte da base ainda
     * está com token antigo, e `modulos` chega `undefined`. Bloquear aqui
     * derrubaria cliente pagante por até uma semana, por uma coisa que ele não
     * fez. Ausência libera; o cliente volta a ser verificado na revalidação
     * seguinte, quando o token renascer com a lista.
     *
     * Lista presente e VAZIA é outra coisa: significa "nenhum módulo", e essa
     * bloqueia normalmente.
     */
    if (erp.modulos === undefined) {
      this.logger.warn(`[modulo] token legado sem claim (licença ${erp.licencaId}) acessando ${requerido} — liberado.`)
      return true
    }

    if (erp.modulos.includes(requerido)) return true

    if (!ENFORCE) {
      this.logger.warn(`[modulo] BLOQUEARIA: licença ${erp.licencaId} sem "${requerido}" (tem: ${erp.modulos.join(', ') || 'nenhum'}). ENTITLEMENTS_ENFORCE desligado — liberado.`)
      return true
    }

    this.logger.warn(`[modulo] bloqueado: licença ${erp.licencaId} sem "${requerido}".`)
    throw new ForbiddenException(`Sua licença não inclui o módulo ${requerido}. Fale com o suporte para contratá-lo.`)
  }
}
