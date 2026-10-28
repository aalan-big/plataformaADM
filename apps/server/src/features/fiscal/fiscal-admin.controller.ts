import { Controller, Get, Post, Body, Param, Query, BadRequestException } from '@nestjs/common'
import { FiscalCotaService } from './fiscal-cota.service'
import { FiscalSaudeService } from './fiscal-saude.service'
import { FiscalFranquiaService } from './fiscal-franquia.service'
import { FiscalExcedenteService, competenciaAnterior } from './fiscal-excedente.service'
import { prisma } from '@startbig/database'
import { MODULO_NFE, MODULO_NFCE, MODULO_NFSE } from '@startbig/database'
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
 * avulso para ele. Restrito aos tipos que a plataforma emite.
 */
const tipoDocumentoSchema = z.enum([MODULO_NFE, MODULO_NFCE, MODULO_NFSE]).default(MODULO_NFE)

const concederExtrasSchema = z.object({
  quantidade: z.number().int().min(1, 'Informe ao menos 1 nota.').max(10_000, 'Quantidade acima do razoável para concessão manual.'),
  motivo:     z.string().trim().max(200).optional(),
  tipoDocumento: tipoDocumentoSchema,
})

@Controller('fiscal/licencas')
export class FiscalAdminController {
  constructor(
    private readonly cota:     FiscalCotaService,
    private readonly franquia: FiscalFranquiaService,
  ) {}

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
    return this.cota.consumoMensal(id, this.parse(tipoDocumentoSchema, tipo))
  }

  @Post(':id/notas-extras')
  conceder(@Param('id') id: string, @Body() body: unknown) {
    const dados = this.parse(concederExtrasSchema, body)
    return this.cota.concederExtras(id, dados.quantidade, dados.motivo, dados.tipoDocumento)
  }

  /** Franquia do mês (todos os documentos) e as últimas faturas de excedente. */
  @Get(':id/franquia')
  async franquiaDaLicenca(@Param('id') id: string) {
    const [situacao, faturas] = await Promise.all([
      this.franquia.situacao(id),
      prisma.faturaExcedenteFiscal.findMany({
        where:   { licencaId: id },
        orderBy: { competencia: 'desc' },
        take:    6,
        select:  { competencia: true, emitidas: true, franquia: true, excedentes: true, valor: true, status: true, erro: true },
      }),
    ])
    return { ...situacao, faturas: faturas.map(f => ({ ...f, valor: Number(f.valor) })) }
  }
}

const competenciaSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Competência no formato AAAA-MM.')

/**
 * Fechamento do excedente à mão. O cron faz isso sozinho no dia 1º; esta rota
 * existe para conferir antes (`simular`) e para retomar uma linha PENDENTE sem
 * esperar o mês seguinte. Rodar de novo não cobra duas vezes.
 */
@Controller('fiscal/excedentes')
export class FiscalExcedenteController {
  constructor(private readonly excedente: FiscalExcedenteService) {}

  @Post('fechar')
  fechar(@Body() body: { competencia?: string; simular?: boolean } = {}) {
    const competencia = competenciaSchema.parse(body?.competencia ?? competenciaAnterior())
    return this.excedente.fecharMes(competencia, { simular: body?.simular !== false })
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
