/**
 * ============================================================================
 * NOME DO ARQUIVO: auth.controller.ts
 * MÓDULO: AUTH
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Atua como o "garçom" da API para o módulo de AUTH. Ele recebe as
 * requisições HTTP (GET, POST, PATCH, DELETE) vindas do frontend ou do ERP
 * e as direciona para o Service correspondente processar.
 * 
 * O QUE ELE CONTÉM:
 * - Rotas e Endpoints da API.
 * - Validação básica de entrada de dados (DTOs).
 * - Respostas HTTP formatadas para o cliente.
 * ============================================================================
 */
import { Controller, Post, Body } from '@nestjs/common'
import { AuthService } from './auth.service'
import { Public } from '../../core/decorators/public.decorator'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; senha: string }) {
    return this.authService.login(body.email, body.senha)
  }
}
