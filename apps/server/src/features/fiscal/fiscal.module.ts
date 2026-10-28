import { Module } from '@nestjs/common'
import { FiscalController, FiscalNfceController, FiscalConfigController } from './fiscal.controller'
import { FiscalNfseController } from './fiscal-nfse.controller'
import { FiscalNfseService } from './fiscal-nfse.service'
import { FiscalAdminController, FiscalSaudeController, FiscalExcedenteController } from './fiscal-admin.controller'
import { FiscalFranquiaService } from './fiscal-franquia.service'
import { FiscalExcedenteService } from './fiscal-excedente.service'
import { FiscalEmissaoService } from './fiscal-emissao.service'
import { FiscalCotaService } from './fiscal-cota.service'
import { FiscalOnboardingService } from './fiscal-onboarding.service'
import { FiscalSaudeService } from './fiscal-saude.service'
import { DispositivoModule } from '../dispositivos/dispositivo.module'

@Module({
  imports:     [DispositivoModule],
  controllers: [FiscalController, FiscalNfceController, FiscalNfseController, FiscalConfigController, FiscalAdminController, FiscalSaudeController, FiscalExcedenteController],
  providers:   [FiscalOnboardingService, FiscalEmissaoService, FiscalNfseService, FiscalCotaService, FiscalSaudeService, FiscalFranquiaService, FiscalExcedenteService],
  exports:     [FiscalOnboardingService, FiscalEmissaoService, FiscalCotaService],
})
export class FiscalModule {}
