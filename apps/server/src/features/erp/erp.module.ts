import { Module } from '@nestjs/common'
import { ErpController } from './erp.controller'
import { ErpUsuarioController } from './erp-usuario.controller'
import { ErpUsuarioService } from './erp-usuario.service'
import { ErpLicencaGuard } from '../../core/guards/erp-licenca.guard'
import { DispositivoModule } from '../dispositivos/dispositivo.module'
import { FinanceiroModule } from '../financeiro/financeiro.module'

@Module({
  imports:     [DispositivoModule, FinanceiroModule],
  controllers: [ErpController, ErpUsuarioController],
  providers:   [ErpUsuarioService, ErpLicencaGuard],
})
export class ErpModule {}
