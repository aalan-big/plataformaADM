import { Module } from '@nestjs/common'
import { FiscalController, FiscalNfceController, FiscalConfigController } from './fiscal.controller'
import { FiscalAdminController } from './fiscal-admin.controller'
import { FiscalService } from './fiscal.service'
import { DispositivoModule } from '../dispositivos/dispositivo.module'

@Module({
  imports:     [DispositivoModule],
  controllers: [FiscalController, FiscalNfceController, FiscalConfigController, FiscalAdminController],
  providers:   [FiscalService],
  exports:     [FiscalService],
})
export class FiscalModule {}
