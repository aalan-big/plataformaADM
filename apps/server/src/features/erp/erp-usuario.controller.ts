import { Controller, Get, Post, Body, Query, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { ErpUsuarioService } from './erp-usuario.service'
import { ErpLicencaGuard } from '../../core/guards/erp-licenca.guard'
import { Public } from '../../core/decorators/public.decorator'

@UseGuards(ErpLicencaGuard)
@Controller('erp/usuario')
export class ErpUsuarioController {
  constructor(private readonly erpUsuarioService: ErpUsuarioService) {}

  @Get('dados')
  getDados(@Req() req: Request & { erp: { licencaId: string } }) {
    return this.erpUsuarioService.getDados(req.erp.licencaId)
  }

  @Post('alterar-senha')
  alterarSenha(
    @Req() req: Request & { erp: { licencaId: string } },
    @Body() body: unknown,
  ) {
    return this.erpUsuarioService.alterarSenha(req.erp.licencaId, body)
  }

  @Post('solicitar-novo-email')
  solicitarNovoEmail(
    @Req() req: Request & { erp: { licencaId: string } },
    @Body() body: unknown,
  ) {
    return this.erpUsuarioService.solicitarNovoEmail(req.erp.licencaId, body)
  }

  // Chamado pela página Next.js após clique no link — não precisa de token de licença
  @Public()
  @Get('confirmar-email')
  confirmarEmail(@Query('token') token: string) {
    return this.erpUsuarioService.confirmarEmail(token)
  }
}
