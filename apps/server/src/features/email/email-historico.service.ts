import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { z, ZodError } from 'zod'
import { prisma, listarEmails, buscarEmail, resumoEmails } from '@startbig/database'

const filtroSchema = z.object({
  status:    z.enum(['ENVIADO', 'FALHOU', 'NAO_ENVIADO']).optional().catch(undefined),
  tipo:      z.string().trim().max(40).optional(),
  q:         z.string().trim().max(120).optional(),
  pagina:    z.coerce.number().int().min(1).catch(1),
  porPagina: z.coerce.number().int().min(1).max(100).catch(30),
})

const DIAS_RESUMO = 30

/**
 * Histórico de e-mails para a tela E-mails do painel (rota de admin, sob o
 * AuthGuard global). Só leitura: quem grava é o `EmailService`, a cada envio.
 */
@Injectable()
export class EmailHistoricoService {
  async listar(query: unknown) {
    let filtro: z.infer<typeof filtroSchema>
    try {
      filtro = filtroSchema.parse(query ?? {})
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException({ erro: 'Filtro inválido', detalhes: e.issues })
      throw e
    }

    const pagina    = filtro.pagina ?? 1
    const porPagina = filtro.porPagina ?? 30

    const desde = new Date(Date.now() - DIAS_RESUMO * 24 * 60 * 60 * 1000)
    const [{ itens, total }, resumo] = await Promise.all([
      listarEmails({ status: filtro.status, tipo: filtro.tipo || undefined, q: filtro.q || undefined, pagina, porPagina }),
      resumoEmails(desde),
    ])

    const nomes = await this.nomesPorEmail(itens.map(i => i.destinatario))

    return {
      itens:     itens.map(i => ({ ...i, nomeCliente: nomes.get(i.destinatario.toLowerCase()) ?? null })),
      total,
      pagina,
      porPagina,
      resumo:    { ...resumo, dias: DIAS_RESUMO },
    }
  }

  async detalhe(id: string) {
    const email = await buscarEmail(id)
    if (!email) throw new NotFoundException('E-mail não encontrado no histórico.')
    const nomes = await this.nomesPorEmail([email.destinatario])
    return { ...email, nomeCliente: nomes.get(email.destinatario.toLowerCase()) ?? null }
  }

  /**
   * Nome do cliente dono de cada destinatário, para a lista não mostrar só
   * e-mails. Pelo e-mail e não por chave estrangeira: o histórico também guarda
   * alerta para o admin, que não é cliente, e não pode sumir se o cliente for
   * apagado.
   */
  private async nomesPorEmail(emails: string[]) {
    const unicos = [...new Set(emails)]
    const mapa = new Map<string, string>()
    if (unicos.length === 0) return mapa

    const clientes = await prisma.cliente.findMany({
      where:  { email: { in: unicos } },
      select: { email: true, pf: { select: { nomeCompleto: true } }, pj: { select: { razaoSocial: true, nomeFantasia: true } } },
    })

    for (const c of clientes) {
      const nome = c.pf?.nomeCompleto ?? c.pj?.nomeFantasia ?? c.pj?.razaoSocial
      if (nome) mapa.set(c.email.toLowerCase(), nome)
    }
    return mapa
  }
}
