import { Controller, Get, Post, Body, Req, Query, UseGuards, BadRequestException } from '@nestjs/common'
import { Request } from 'express'
import { FiscalService } from './fiscal.service'
import { ErpLicencaGuard } from '../../core/guards/erp-licenca.guard'
import { Public } from '../../core/decorators/public.decorator'
import { z, ZodError } from 'zod'

type ReqErp = Request & { erp: { licencaId: string } }

export const emitirNfeSchema = z.object({
  ref: z.string().min(1, 'A referência (ref) é obrigatória.'),
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

@Public()
@UseGuards(ErpLicencaGuard)
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
    @Query('ref') ref: string
  ) {
    return this.fiscalService.consultar(req.erp.licencaId, ref)
  }

  @Post('cancelar')
  cancelar(
    @Req() req: ReqErp,
    @Body() body: { ref: string; justificativa: string }
  ) {
    return this.fiscalService.cancelar(req.erp.licencaId, body.ref, body.justificativa)
  }
}
