import { Module } from '@nestjs/common'
import { ModuloController } from './modulo.controller'
import { StripeModule } from '../../common/stripe/stripe.module'

@Module({ imports: [StripeModule], controllers: [ModuloController] })
export class ModuloModule {}
