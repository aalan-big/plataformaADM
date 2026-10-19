import { Controller, Get, Param, Query } from '@nestjs/common'
import { EmailHistoricoService } from './email-historico.service'
import { Roles } from '../../core/decorators/roles.decorator'

/// Rotas do PAINEL (token de admin, AuthGuard global). Só leitura.
@Roles('ADMIN')
@Controller('email')
export class EmailHistoricoController {
  constructor(private readonly historico: EmailHistoricoService) {}

  @Get('historico')
  listar(@Query() query: Record<string, string>) {
    return this.historico.listar(query)
  }

  @Get('historico/:id')
  detalhe(@Param('id') id: string) {
    return this.historico.detalhe(id)
  }
}
