import { Controller, Get, Post, Body, Param, BadRequestException } from '@nestjs/common'
import { FiscalService } from './fiscal.service'
import { z, ZodError } from 'zod'

/**
 * Lado administrativo do fiscal.
 *
 * Separado do `FiscalController` de propósito: aquele é `@Public()` e protegido
 * pelo JWT de licença do ERP, este fica sob a autenticação normal do painel.
 * Juntar os dois no mesmo controller significaria um decorator errado abrindo
 * concessão de cota para quem tem token de licença.
 */
const concederExtrasSchema = z.object({
  quantidade: z.number().int().min(1, 'Informe ao menos 1 nota.').max(10_000, 'Quantidade acima do razoável para concessão manual.'),
  motivo:     z.string().trim().max(200).optional(),
})

@Controller('fiscal/licencas')
export class FiscalAdminController {
  constructor(private readonly fiscalService: FiscalService) {}

  @Get(':id/consumo')
  consumo(@Param('id') id: string) {
    return this.fiscalService.consumoMensal(id)
  }

  @Post(':id/notas-extras')
  conceder(@Param('id') id: string, @Body() body: unknown) {
    try {
      const dados = concederExtrasSchema.parse(body)
      return this.fiscalService.concederExtras(id, dados.quantidade, dados.motivo)
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          erro: 'Dados inválidos',
          detalhes: e.issues.map(i => ({ campo: i.path.join('.'), mensagem: i.message })),
        })
      }
      throw e
    }
  }
}
