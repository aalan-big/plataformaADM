import { Injectable, BadRequestException, ConflictException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ZodError, z } from 'zod'
import bcrypt from 'bcryptjs'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const alterarSenhaSchema = z.object({
  senhaAtual: z.string().optional(),
  novaSenha:  z.string().min(8, 'A nova senha deve ter no mínimo 8 caracteres.'),
})

const solicitarEmailSchema = z.object({
  novoEmail:  z.string().email('E-mail inválido.'),
  senhaAtual: z.string(),
})

@Injectable()
export class ErpUsuarioService {

  private parseBody<T>(schema: { parse: (x: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }
  }

  private get prisma() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prisma } = require('@startbig/database')
    return prisma
  }

  async getDados(licencaId: string) {
    const licenca = await this.prisma.licenca.findUnique({
      where:   { id: licencaId },
      include: { cliente: { include: { pf: true, pj: true } } },
    })
    if (!licenca) throw new BadRequestException('Licença não encontrada.')

    const { cliente } = licenca
    const nome = cliente.pf?.nomeCompleto ?? cliente.pj?.razaoSocial ?? ''
    return { nome, email: cliente.email, temSenha: !!cliente.senhaHash }
  }

  async alterarSenha(licencaId: string, body: unknown) {
    const dados   = this.parseBody(alterarSenhaSchema, body)
    const licenca = await this.prisma.licenca.findUnique({
      where:   { id: licencaId },
      include: { cliente: true },
    })
    if (!licenca) throw new BadRequestException('Licença não encontrada.')

    const { cliente } = licenca

    if (cliente.senhaHash) {
      if (!dados.senhaAtual)
        throw new BadRequestException('Informe a senha atual para alterá-la.')
      const senhaValida = await bcrypt.compare(dados.senhaAtual, cliente.senhaHash)
      if (!senhaValida) throw new BadRequestException('Senha atual incorreta.')
    }

    const novoHash = await bcrypt.hash(dados.novaSenha, 10)
    await this.prisma.cliente.update({
      where: { id: cliente.id },
      data:  { senhaHash: novoHash },
    })

    await resend.emails.send({
      from:    'noreply@startbig.com.br',
      to:      cliente.email,
      subject: 'Sua senha foi alterada — StartBig',
      html:    `<p>Sua senha de acesso ao StartBig foi alterada com sucesso.<br/>Se não foi você, entre em contato com o suporte imediatamente.</p>`,
    })

    return { mensagem: 'Senha alterada com sucesso.' }
  }

  async solicitarNovoEmail(licencaId: string, body: unknown) {
    const dados   = this.parseBody(solicitarEmailSchema, body)
    const licenca = await this.prisma.licenca.findUnique({
      where:   { id: licencaId },
      include: { cliente: true },
    })
    if (!licenca) throw new BadRequestException('Licença não encontrada.')

    const { cliente } = licenca

    if (!cliente.senhaHash)
      throw new BadRequestException('Nenhuma senha configurada. Defina sua senha antes de alterar o e-mail.')

    const senhaValida = await bcrypt.compare(dados.senhaAtual, cliente.senhaHash)
    if (!senhaValida) throw new BadRequestException('Senha atual incorreta.')

    const emailExiste = await this.prisma.cliente.findFirst({ where: { email: dados.novoEmail } })
    if (emailExiste) throw new ConflictException('E-mail já cadastrado no sistema.')

    const token = randomUUID()
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await this.prisma.cliente.update({
      where: { id: cliente.id },
      data:  {
        emailPendente:      dados.novoEmail,
        tokenEmail:         token,
        tokenEmailExpiraEm: expira,
      },
    })

    const appUrl = process.env.APP_URL ?? 'https://admin.startbig.com.br'
    await resend.emails.send({
      from:    'noreply@startbig.com.br',
      to:      dados.novoEmail,
      subject: 'Confirme seu novo e-mail — StartBig',
      html:    `<p>Clique no link abaixo para confirmar a troca de e-mail:<br/>
               <a href="${appUrl}/confirmar-email?token=${token}">Confirmar e-mail</a><br/><br/>
               Este link expira em 24 horas.</p>`,
    })

    return { mensagem: 'Verifique seu novo e-mail para confirmar a troca.' }
  }

  async confirmarEmail(token: string) {
    if (!token) throw new BadRequestException('Token não informado.')

    const cliente = await this.prisma.cliente.findFirst({ where: { tokenEmail: token } })
    if (!cliente) throw new BadRequestException('Token inválido.')
    if (new Date() > new Date(cliente.tokenEmailExpiraEm))
      throw new BadRequestException('Token expirado. Solicite uma nova troca de e-mail.')

    const emailAntigo = cliente.email

    await this.prisma.cliente.update({
      where: { id: cliente.id },
      data:  {
        email:              cliente.emailPendente,
        emailPendente:      null,
        tokenEmail:         null,
        tokenEmailExpiraEm: null,
      },
    })

    await resend.emails.send({
      from:    'noreply@startbig.com.br',
      to:      emailAntigo,
      subject: 'Seu e-mail foi alterado — StartBig',
      html:    `<p>Seu e-mail de acesso ao StartBig foi alterado com sucesso.<br/>Se não foi você, entre em contato com o suporte imediatamente.</p>`,
    })

    return { mensagem: 'E-mail confirmado com sucesso.' }
  }
}
