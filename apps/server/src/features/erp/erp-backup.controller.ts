import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { ErpBackupService } from './erp-backup.service'
import { ErpLicencaGuard } from '../../core/guards/erp-licenca.guard'
import { Public } from '../../core/decorators/public.decorator'

/// Contexto que o ErpLicencaGuard injeta a partir do JWT da licença.
/// O clienteId NÃO vem do token nem do corpo — é derivado da licença no banco,
/// que é a única fonte que o cliente não consegue influenciar.
type ReqErp = Request & { erp: { licencaId: string; hwid: string | null } }

/// `@Public()` aqui NÃO significa rota aberta — significa "não é o admin que
/// entra". Guards globais rodam antes dos de controller, e o AuthGuard global
/// valida HS256 com o segredo do painel; o token da licença é RS256 e seria
/// rejeitado por ele antes de o ErpLicencaGuard sequer rodar. O `@Public()`
/// tira o guard do admin do caminho e o ErpLicencaGuard continua exigindo
/// token de licença válido.
@Public()
@UseGuards(ErpLicencaGuard)
@Controller('erp/backup')
export class ErpBackupController {
  constructor(private readonly erpBackupService: ErpBackupService) {}

  @Post('url-upload')
  urlUpload(@Req() req: ReqErp, @Body() body: unknown) {
    return this.erpBackupService.urlUpload(req.erp.licencaId, req.erp.hwid, body)
  }

  @Post('confirmar')
  confirmar(@Req() req: ReqErp, @Body() body: unknown) {
    return this.erpBackupService.confirmar(req.erp.licencaId, body)
  }

  @Get('status')
  status(@Req() req: ReqErp) {
    return this.erpBackupService.status(req.erp.licencaId)
  }

  @Post('url-download')
  urlDownload(@Req() req: ReqErp, @Body() body: unknown) {
    return this.erpBackupService.urlDownload(req.erp.licencaId, req.erp.hwid, body)
  }
}
