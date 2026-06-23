import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ZodError, z } from 'zod'
import bcrypt from 'bcryptjs'
import { Resend } from 'resend'
import { DispositivoService } from '../dispositivos/dispositivo.service'

const resend = new Resend(process.env.RESEND_API_KEY)

const loginSchema = z.object({
  email: z.string().email('E-mail inválido.'),
  senha: z.string(),
  hwid:  z.string().optional(),
})

const primeiroAcessoSchema = z.object({
  token:     z.string(),
  novaSenha: z.string().min(8, 'A senha deve ter no mínimo 8 caracteres.'),
})

@Injectable()
export class ErpAuthService {
  constructor(private readonly dispositivoService: DispositivoService) {}

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

  async login(body: unknown) {
    const dados = this.parseBody(loginSchema, body)

    const cliente = await this.prisma.cliente.findFirst({
      where:   { email: dados.email },
      include: {
        dispositivos: {
          where:   { status: 'ATIVA' },
          orderBy: { criadoEm: 'desc' },
          take:    1,
        },
      },
    })

    if (!cliente)
      throw new UnauthorizedException('E-mail ou senha incorretos.')

    if (!cliente.senhaHash)
      throw new BadRequestException('Senha não configurada. Verifique seu e-mail para criar sua senha de acesso.')

    const senhaValida = await bcrypt.compare(dados.senha, cliente.senhaHash)
    if (!senhaValida)
      throw new UnauthorizedException('E-mail ou senha incorretos.')

    const licenca = cliente.dispositivos[0]
    if (!licenca)
      throw new BadRequestException('Nenhuma licença ativa encontrada para este e-mail.')

    // Reutiliza o fluxo de conectar passando a chave da licença
    return this.dispositivoService.conectar({
      chave: licenca.chaveAtivacao,
      hwid:  dados.hwid ?? `login-${randomUUID()}`,
    })
  }

  async primeiroAcesso(body: unknown) {
    const dados = this.parseBody(primeiroAcessoSchema, body)

    const cliente = await this.prisma.cliente.findFirst({
      where: { tokenEmail: dados.token },
    })

    if (!cliente)
      throw new BadRequestException('Link inválido.')

    if (new Date() > new Date(cliente.tokenEmailExpiraEm))
      throw new BadRequestException('Link expirado. Entre em contato com o suporte para receber um novo.')

    const senhaHash = await bcrypt.hash(dados.novaSenha, 10)

    await this.prisma.cliente.update({
      where: { id: cliente.id },
      data:  {
        senhaHash,
        tokenEmail:         null,
        tokenEmailExpiraEm: null,
      },
    })

    return { mensagem: 'Senha criada com sucesso. Você já pode fazer login no sistema.' }
  }

  async enviarEmailPrimeiroAcesso(clienteId: string, email: string, nome: string) {
    const token = randomUUID()
    const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias

    await this.prisma.cliente.update({
      where: { id: clienteId },
      data:  {
        tokenEmail:         token,
        tokenEmailExpiraEm: expira,
      },
    })

    const appUrl = process.env.APP_URL ?? 'https://admin.startbig.com.br'

    try {
      const { error } = await resend.emails.send({
        from:    process.env.EMAIL_FROM ?? 'noreply@startbig.com.br',
        to:      email,
        subject: 'Bem-vindo ao StartBig — Crie sua senha de acesso',
        html:    `
          <p>Olá, <strong>${nome}</strong>!</p>
          <p>Sua empresa foi cadastrada com sucesso no StartBig.</p>
          <p>Clique no link abaixo para criar sua senha de acesso ao portal:</p>
          <p><a href="${appUrl}/primeiro-acesso?token=${token}">Criar minha senha</a></p>
          <p>Este link expira em 7 dias.</p>
          <p>Se não foi você quem se cadastrou, ignore este e-mail.</p>
        `,
      })
      if (error) console.warn('[email] primeiro-acesso Resend error:', JSON.stringify(error))
      else console.log('[email] primeiro-acesso enviado para', email)
    } catch (err) {
      console.warn('[email] falha ao enviar primeiro-acesso:', err instanceof Error ? err.message : err)
    }
  }
}
