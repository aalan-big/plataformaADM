import { Module } from '@nestjs/common'
import { FiscalController, FiscalNfceController, FiscalConfigController } from './fiscal.controller'
import { FiscalAdminController, FiscalSaudeController } from './fiscal-admin.controller'
import { FiscalService } from './fiscal.service'
import { FiscalSaudeService } from './fiscal-saude.service'
import { DispositivoModule } from '../dispositivos/dispositivo.module'

@Module({
  imports:     [DispositivoModule],
  controllers: [FiscalController, FiscalNfceController, FiscalConfigController, FiscalAdminController, FiscalSaudeController],
  providers:   [FiscalService, FiscalSaudeService],
  exports:     [FiscalService],
})
export class FiscalModule {}
