import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ZodError, z } from 'zod'
import bcrypt from 'bcryptjs'
import { DispositivoService } from '../dispositivos/dispositivo.service'

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
          include: { plano: true },
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

    // Reutiliza o fluxo de conectar passando a chave da licença.
    // autenticado: true → identidade já provada por email+senha, então em caso de
    // limite de dispositivos atingido a sessão antiga é encerrada em vez de bloquear.
    const resultado = await this.dispositivoService.conectar(
      {
        chave: licenca.chaveAtivacao,
        hwid:  dados.hwid ?? `login-${randomUUID()}`,
      },
      { autenticado: true },
    )

    // O ERP precisa guardar a chaveAtivacao localmente para os próximos
    // /licenca/validar e /licenca/desconectar — conectar() não a devolve
    // porque normalmente quem chama já a tem.
    return { ...resultado, chaveAtivacao: licenca.chaveAtivacao }
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
}
