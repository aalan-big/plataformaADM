import { Module } from '@nestjs/common'
import { FinanceiroController } from './financeiro.controller'
import { FinanceiroService } from './financeiro.service'
@Module({
  imports:     [],
  controllers: [FinanceiroController],
  providers:   [FinanceiroService],
  exports:     [FinanceiroService],
})
export class FinanceiroModule {}
