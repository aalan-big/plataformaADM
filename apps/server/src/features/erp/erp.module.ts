import { Module } from '@nestjs/common'
import { DispositivoModule } from '../dispositivos/dispositivo.module'
import { FinanceiroModule } from '../financeiro/financeiro.module'
import { PlanoModule } from '../plano/plano.module'
import { ErpContratacaoService } from './erp-contratacao.service'

import { ErpLicencaController }  from './erp-licenca.controller'
import { ErpCobrancaController } from './erp-cobranca.controller'
import { ErpAuthController }     from './erp-auth.controller'
import { ErpAuthService }        from './erp-auth.service'
import { ErpUsuarioController }  from './erp-usuario.controller'
import { ErpUsuarioService }     from './erp-usuario.service'
import { ErpLicencaGuard }       from '../../core/guards/erp-licenca.guard'

@Module({
  imports:     [DispositivoModule, FinanceiroModule, PlanoModule],
  controllers: [
    ErpLicencaController,
    ErpCobrancaController,
    ErpAuthController,
    ErpUsuarioController,
  ],
  providers: [
    ErpAuthService,
    ErpUsuarioService,
    ErpContratacaoService,
    ErpLicencaGuard,
  ],
})
export class ErpModule {}
