import { Controller, Post, Body } from '@nestjs/common'
import { ErpAuthService } from './erp-auth.service'
import { Public } from '../../core/decorators/public.decorator'

@Public()
@Controller('erp/auth')
export class ErpAuthController {
  constructor(private readonly erpAuthService: ErpAuthService) {}

  @Post('login')
  login(@Body() body: unknown) {
    return this.erpAuthService.login(body)
  }

  @Post('primeiro-acesso')
  primeiroAcesso(@Body() body: unknown) {
    return this.erpAuthService.primeiroAcesso(body)
  }
}
