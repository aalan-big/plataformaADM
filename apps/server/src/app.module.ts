/**
 * ============================================================================
 * NOME DO ARQUIVO: app.module.ts
 * MÓDULO: INICIALIZAÇÃO DO SERVIDOR
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como a "caixa de fios" (Wiring) do módulo de INICIALIZAÇÃO DO SERVIDOR. Ele agrupa
 * os Controllers e Services deste módulo e diz ao NestJS como eles se conectam.
 * 
 * O QUE ELE CONTÉM:
 * - Declaração de Providers (Services).
 * - Declaração de Controllers.
 * - Importação de outros módulos necessários para este funcionar.
 * ============================================================================
 */
import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { AuthModule } from './features/auth/auth.module'
import { ClienteModule } from './features/cliente/cliente.module'
import { UsuarioModule } from './features/usuario/usuario.module'
import { EnderecoModule } from './features/endereco/endereco.module'
import { DispositivoModule } from './features/dispositivos/dispositivo.module'
import { FinanceiroModule } from './features/financeiro/financeiro.module'
import { CronModule } from './features/cron/cron.module'
import { PlanoModule } from './features/plano/plano.module'
import { StripeModule } from './common/stripe/stripe.module'
import { EmailModule } from './core/email/email.module'
import { AuthGuard } from './core/guards/auth.guard'
import { RolesGuard } from './core/guards/roles.guard'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    StripeModule,
    EmailModule,
    AuthModule,
    ClienteModule,
    UsuarioModule,
    EnderecoModule,
    DispositivoModule,
    FinanceiroModule,
    CronModule,
    PlanoModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}