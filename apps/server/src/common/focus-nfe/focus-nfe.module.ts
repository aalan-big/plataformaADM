import { Global, Module } from '@nestjs/common'
import { FocusNfeService } from './focus-nfe.service'

@Global()
@Module({
  providers: [FocusNfeService],
  exports:   [FocusNfeService],
})
export class FocusNfeModule {}
