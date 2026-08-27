import { Module } from '@nestjs/common'
import { ModuloController } from './modulo.controller'

@Module({ controllers: [ModuloController] })
export class ModuloModule {}
