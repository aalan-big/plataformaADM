import { Module } from '@nestjs/common'
import { EmailHistoricoController } from './email-historico.controller'
import { EmailHistoricoService } from './email-historico.service'

@Module({
  controllers: [EmailHistoricoController],
  providers:   [EmailHistoricoService],
})
export class EmailHistoricoModule {}
