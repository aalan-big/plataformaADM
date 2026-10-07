import { Controller, Get, Post, Body, Param, Query, BadRequestException } from '@nestjs/common'
import { FiscalService } from './fiscal.service'
import { FiscalSaudeService } from './fiscal-saude.service'
import { MODULO_NFE, MODULO_NFCE } from '@startbig/database'
import { z, ZodError } from 'zod'

/**
 * Lado administrativo do fiscal.
 *
 * Separado do `FiscalController` de propósito: aquele é `@Public()` e protegido
 * pelo JWT de licença do ERP, este fica sob a autenticação normal do painel.
 * Juntar os dois no mesmo controller significaria um decorator errado abrindo
 * concessão de cota para quem tem token de licença.
 */

/**
 * Qual documento o admin está olhando.
 *
 * Cota e consumo são POR TIPO, e o painel só sabia perguntar de NF-e: a NFC-e
 * de um cliente não aparecia em lugar nenhum e não havia como conceder cupom
 * avulso para ele. Restrito aos dois que a plataforma emite — NFS-e existe no
 * contador mas não tem emissão, e oferecer no painel criaria cota para um
 * produto que não sai.
 */
const tipoDocumentoSchema = z.enum([MODULO_NFE, MODULO_NFCE]).default(MODULO_NFE)

const concederExtrasSchema = z.object({
  quantidade: z.number().int().min(1, 'Informe ao menos 1 nota.').max(10_000, 'Quantidade acima do razoável para concessão manual.'),
  motivo:     z.string().trim().max(200).optional(),
  tipoDocumento: tipoDocumentoSchema,
})

@Controller('fiscal/licencas')
export class FiscalAdminController {
  constructor(private readonly fiscalService: FiscalService) {}

  private parse<T>(schema: { parse: (x: unknown) => T }, valor: unknown): T {
    try {
      return schema.parse(valor)
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

  @Get(':id/consumo')
  consumo(@Param('id') id: string, @Query('tipo') tipo?: string) {
    // Ausente vira NFE pelo `.default`, que é o que o painel pedia antes de
    // existir seletor — link antigo e aba aberta continuam funcionando.
    return this.fiscalService.consumoMensal(id, this.parse(tipoDocumentoSchema, tipo))
  }

  @Post(':id/notas-extras')
  conceder(@Param('id') id: string, @Body() body: unknown) {
    const dados = this.parse(concederExtrasSchema, body)
    return this.fiscalService.concederExtras(id, dados.quantidade, dados.motivo, dados.tipoDocumento)
  }
}

/**
 * Painel de saúde fiscal por cliente (F4). Só leitura: o "Rodar conferência"
 * do admin é este mesmo GET de novo — nada emite, nada grava, nem aqui nem na
 * Focus. Por CLIENTE e não por licença porque a ficha fiscal é do cliente.
 */
@Controller('fiscal/clientes')
export class FiscalSaudeController {
  constructor(private readonly saudeService: FiscalSaudeService) {}

  @Get(':id/saude')
  saude(@Param('id') id: string) {
    return this.saudeService.saudeDoCliente(id)
  }
}
