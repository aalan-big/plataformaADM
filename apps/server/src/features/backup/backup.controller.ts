import { Controller, Get, Param } from '@nestjs/common'
import { BackupService } from './backup.service'

/// Rotas do PAINEL, não do ERP. Ficam sob o AuthGuard global (token de admin) —
/// o oposto de /erp/backup/*, que usa token de licença. Leitura pura: o painel
/// mostra, quem escreve é o ERP.
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
}
