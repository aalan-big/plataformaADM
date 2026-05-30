import { Module } from '@nestjs/common'
import { DispositivoModule } from '../dispositivos/dispositivo.module'
import { FinanceiroModule } from '../financeiro/financeiro.module'

import { ErpLicencaController }  from './erp-licenca.controller'
import { ErpCobrancaController } from './erp-cobranca.controller'
import { ErpAuthController }     from './erp-auth.controller'
import { ErpAuthService }        from './erp-auth.service'
import { ErpUsuarioController }  from './erp-usuario.controller'
import { ErpUsuarioService }     from './erp-usuario.service'
import { ErpLicencaGuard }       from '../../core/guards/erp-licenca.guard'

@Module({
  imports:     [DispositivoModule, FinanceiroModule],
  controllers: [
    ErpLicencaController,
    ErpCobrancaController,
    ErpAuthController,
    ErpUsuarioController,
  ],
  providers: [
    ErpAuthService,
    ErpUsuarioService,
    ErpLicencaGuard,
  ],
})
export class ErpModule {}
