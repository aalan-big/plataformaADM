import { Module } from '@nestjs/common'
import { DispositivoController } from './dispositivo.controller'
import { DispositivoService } from './dispositivo.service'
import { EmailModule } from '../../core/email/email.module'

@Module({
  imports:     [EmailModule],
  controllers: [DispositivoController],
  providers:   [DispositivoService],
})
export class DispositivoModule {}
