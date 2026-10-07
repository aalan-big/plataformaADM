import { Module } from '@nestjs/common'
import { FiscalController, FiscalNfceController, FiscalConfigController } from './fiscal.controller'
import { FiscalAdminController, FiscalSaudeController } from './fiscal-admin.controller'
import { FiscalEmissaoService } from './fiscal-emissao.service'
import { FiscalCotaService } from './fiscal-cota.service'
import { FiscalOnboardingService } from './fiscal-onboarding.service'
import { FiscalSaudeService } from './fiscal-saude.service'
import { DispositivoModule } from '../dispositivos/dispositivo.module'

@Module({
  imports:     [DispositivoModule],
  controllers: [FiscalController, FiscalNfceController, FiscalConfigController, FiscalAdminController, FiscalSaudeController],
  providers:   [FiscalOnboardingService, FiscalEmissaoService, FiscalCotaService, FiscalSaudeService],
  exports:     [FiscalOnboardingService, FiscalEmissaoService, FiscalCotaService],
})
export class FiscalModule {}
