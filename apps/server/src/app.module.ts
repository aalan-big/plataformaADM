import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthModule } from './features/auth/auth.module'
import { ClienteModule } from './features/cliente/cliente.module'
import { UsuarioModule } from './features/usuario/usuario.module'
import { EnderecoModule } from './features/endereco/endereco.module'
import { DispositivoModule } from './features/dispositivos/dispositivo.module'
import { FinanceiroModule } from './features/financeiro/financeiro.module'
import { StripeModule } from './common/stripe/stripe.module'
import { EmailModule } from './core/email/email.module'
import { AuthGuard } from './core/guards/auth.guard'

@Module({
  imports: [
    StripeModule,
    EmailModule,
    AuthModule,
    ClienteModule,
    UsuarioModule,
    EnderecoModule,
    DispositivoModule,
    FinanceiroModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}