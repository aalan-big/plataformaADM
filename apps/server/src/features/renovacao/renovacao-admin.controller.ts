/**
 * ============================================================================
 * NOME DO ARQUIVO: renovacao-admin.controller.ts
 * MÓDULO: RENOVAÇÃO
 * ============================================================================
 * Cobrança PIX gerada pelo painel, para o operador mandar ao cliente.
 *
 * Separado do controller do ERP porque a credencial é outra: aqui vale a sessão
 * de ADMIN, e a licença é identificada por id — quem opera o painel já sabe de
 * quem está falando. Misturar os dois num controller só significaria uma rota
 * pública aceitando `licencaId`, que é exatamente o que a gente evitou.
 * ============================================================================
 */
import { Controller, Post, Body } from '@nestjs/common'
import { RenovacaoService } from './renovacao.service'
import { Roles } from '../../core/decorators/roles.decorator'

@Roles('ADMIN')
@Controller('renovacao/admin')
export class RenovacaoAdminController {
  constructor(private readonly renovacaoService: RenovacaoService) {}

  /** Cria o PIX. Com `planoId`, vende uma troca de plano; sem ele, renovação. */
  @Post('cobranca-pix')
  cobrancaPix(@Body() body: { licencaId?: string; meses?: number; planoId?: string }) {
    return this.renovacaoService.cobrancaPixAdmin(body ?? {})
  }
}
