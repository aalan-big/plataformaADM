import { Module } from '@nestjs/common'
import { FiscalController } from './fiscal.controller'
import { FiscalService } from './fiscal.service'
import { DispositivoModule } from '../dispositivos/dispositivo.module'

@Module({
  imports:     [DispositivoModule],
  controllers: [FiscalController],
  providers:   [FiscalService],
  exports:     [FiscalService],
})
export class FiscalModule {}
