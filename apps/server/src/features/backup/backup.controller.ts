import { Controller, Get, Post, Param, Body, Req } from '@nestjs/common'
import { Request } from 'express'
import { BackupService } from './backup.service'

/// Rotas do PAINEL, não do ERP. Ficam sob o AuthGuard global (token de admin) —
/// o oposto de /erp/backup/*, que usa token de licença.
@Controller('backups')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get()
  visaoGeral() {
    return this.backupService.visaoGeral()
  }

  @Get(':licencaId/eventos')
  eventos(@Param('licencaId') licencaId: string) {
    return this.backupService.eventos(licencaId)
  }

  @Post(':licencaId/url-download')
  urlDownload(
    @Param('licencaId') licencaId: string,
    @Body() body: { tipo?: string; periodo?: string },
    @Req() req: Request & { user?: { userId?: string } },
  ) {
    // O IP vem do proxy à frente da API (Nginx), então o cabeçalho encaminhado
    // vale mais que o socket. É registro de auditoria, não controle de acesso —
    // dado forjável aqui não abre porta nenhuma, só suja a trilha.
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null

    return this.backupService.urlDownloadAdmin(licencaId, body?.tipo ?? 'banco', {
      usuarioId: req.user?.userId ?? null,
      ip,
      periodo:   body?.periodo ?? null,
    })
  }
}
