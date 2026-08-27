import { Controller, Get, Post, Body, Req, Query, UseGuards, BadRequestException } from '@nestjs/common'
import { Request } from 'express'
import { FiscalService } from './fiscal.service'
import { ErpLicencaGuard } from '../../core/guards/erp-licenca.guard'
import { ModuloGuard } from '../../core/guards/modulo.guard'
import { Public } from '../../core/decorators/public.decorator'
import { RequerModulo } from '../../core/decorators/requer-modulo.decorator'
import { MODULO_NFE } from '@startbig/database'
import { refNotaSchema } from '@startbig/schemas'
import { z, ZodError } from 'zod'

type ReqErp = Request & { erp: { licencaId: string } }

export const emitirNfeSchema = z.object({
  ref: refNotaSchema,
  payload: z.object({
    natureza_operacao: z.string().min(1, 'Natureza de operação é obrigatória.'),
    tipo_documento: z.number().int(),
    emitente: z.object({
      cnpj: z.string().transform(s => s.replace(/\D/g, '')).refine(s => s.length === 14, 'CNPJ do emitente inválido.'),
      razao_social: z.string().min(1, 'Razão social do emitente é obrigatória.'),
      endereco: z.object({
        logradouro: z.string().min(1),
        numero: z.string().min(1),
        bairro: z.string().min(1),
        cidade: z.string().min(1),
        uf: z.string().length(2),
        cep: z.string(),
      })
    }),
    destinatario: z.object({
      cpf: z.string().optional(),
      cnpj: z.string().optional(),
      nome: z.string().min(1, 'Nome do destinatário é obrigatório.'),
    }).refine(data => data.cpf || data.cnpj, {
      message: 'CPF ou CNPJ do destinatário deve ser fornecido.',
      path: ['cpf']
    }),
    items: z.array(
      z.object({
        numero_item: z.number().int(),
        codigo_produto: z.string().min(1),
        descricao: z.string().min(1),
        ncm: z.string().min(1),
        cfop: z.string().min(1),
        quantidade_comercial: z.number().positive(),
        valor_unitario_comercial: z.number().nonnegative(),
        valor_bruto: z.number().nonnegative(),
      })
    ).min(1, 'A nota deve conter pelo menos um item.'),
    totais: z.object({
      valor_total: z.number().nonnegative(),
    })
  })
})

export const cancelarNfeSchema = z.object({
  ref: refNotaSchema,
  // 15 caracteres é exigência da SEFAZ, não escolha nossa.
  justificativa: z.string().trim().min(15, 'A justificativa de cancelamento deve conter no mínimo 15 caracteres.'),
})

/**
 * A ordem dos guards importa: `ErpLicencaGuard` valida o JWT e preenche
 * `request.erp`, e só então o `ModuloGuard` tem o que ler. Invertidos, o
 * segundo não acharia licença nenhuma.
 *
 * O `RequerModulo` fica AQUI, no controller do fiscal, e não no
 * `ErpLicencaGuard`: aquele protege todas as rotas `/erp/*`, e mexer nele
 * colocaria uma trava de módulo no caminho de conectar, validar e heartbeat de
 * toda a base.
 */
@Public()
@UseGuards(ErpLicencaGuard, ModuloGuard)
@RequerModulo(MODULO_NFE)
@Controller('erp/fiscal/nfe')
export class FiscalController {
  constructor(private readonly fiscalService: FiscalService) {}

  private parseBody<T>(schema: { parse: (x: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body)
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          erro: 'Estrutura JSON inválida',
          detalhes: e.issues.map(issue => ({
            campo: issue.path.join('.'),
            mensagem: issue.message
          }))
        })
      }
      throw e
    }
  }

  @Post('emitir')
  emitir(
    @Req() req: ReqErp,
    @Body() body: unknown
  ) {
    const dados = this.parseBody(emitirNfeSchema, body)
    return this.fiscalService.emitir(req.erp.licencaId, dados.ref, dados.payload)
  }

  @Get('consultar')
  consultar(
    @Req() req: ReqErp,
    @Query('ref') ref: unknown
  ) {
    const refValida = this.parseBody(refNotaSchema, ref)
    return this.fiscalService.consultar(req.erp.licencaId, refValida)
  }

  @Post('cancelar')
  cancelar(
    @Req() req: ReqErp,
    @Body() body: unknown
  ) {
    const dados = this.parseBody(cancelarNfeSchema, body)
    return this.fiscalService.cancelar(req.erp.licencaId, dados.ref, dados.justificativa)
  }

  /**
   * Quanto desta licença já foi usado no mês.
   *
   * Existe para o ERP conseguir avisar o operador ANTES de ele montar a nota
   * inteira e levar um 402 no envio. Não é trava: quem barra de verdade é o
   * `emitir`, no servidor, porque toda emissão passa por aqui de qualquer jeito.
   */
  @Get('consumo')
  consumo(@Req() req: ReqErp) {
    return this.fiscalService.consumoMensal(req.erp.licencaId)
  }
}
