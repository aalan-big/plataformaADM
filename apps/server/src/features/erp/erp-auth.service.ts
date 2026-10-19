import { Injectable, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ZodError, z } from 'zod'
import bcrypt from 'bcryptjs'
import { DispositivoService } from '../dispositivos/dispositivo.service'

const loginSchema = z.object({
  email: z.string().email('E-mail inválido.'),
  senha: z.string(),
  hwid:  z.string().optional(),
  /** Hostname da máquina, só para leitura humana (e-mail de aviso, suporte). */
  nomeComputador: z.string().trim().max(100).optional(),
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

  /**
   * Erro com `codigo` estável: a tela do ERP decide pela chave, sem depender
   * do texto. O status HTTP continua o de antes onde já existia (401 = senha).
   */
  private erro(status: HttpStatus, codigo: string, message: string): HttpException {
    return new HttpException({ codigo, message }, status)
  }

  private get prisma() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prisma } = require('@startbig/database')
    return prisma
  }

  async login(body: unknown) {
    const dados = this.parseBody(loginSchema, body)

    // VENCIDA entra na busca por causa da carência: com o cartão sendo
    // re-tentado o dono continua usando o sistema, e precisa conseguir trocar
    // de computador também — senão a troca é a única coisa que a carência não
    // cobre.
    const cliente = await this.prisma.cliente.findFirst({
      where:   { email: dados.email },
      include: {
        dispositivos: {
          where:   { status: { in: ['ATIVA', 'VENCIDA'] } },
          orderBy: { criadoEm: 'desc' },
          include: { plano: true },
        },
      },
    })

    if (!cliente)
      throw this.erro(HttpStatus.UNAUTHORIZED, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos.')

    if (!cliente.senhaHash)
      throw this.erro(
        HttpStatus.BAD_REQUEST,
        'SENHA_NAO_CONFIGURADA',
        'Senha não configurada. Verifique seu e-mail para criar sua senha de acesso.',
      )

    const senhaValida = await bcrypt.compare(dados.senha, cliente.senhaHash)
    if (!senhaValida)
      throw this.erro(HttpStatus.UNAUTHORIZED, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos.')

    // A mesma regra do conectar: ATIVA dentro do prazo, ou qualquer uma com
    // carência vigente. Checada aqui para responder 402 com código, em vez do
    // 400 genérico que o conectar daria.
    const agora = new Date()
    const utilizavel = (l: { status: string; dataVencimento: Date | null; carenciaAte: Date | null }) =>
      this.dispositivoService.carenciaVigente(l) ||
      (l.status === 'ATIVA' && (!l.dataVencimento || l.dataVencimento > agora))

    const licenca = cliente.dispositivos.find(utilizavel)
    if (!licenca) {
      if (cliente.dispositivos.length > 0)
        throw this.erro(
          HttpStatus.PAYMENT_REQUIRED,
          'LICENCA_VENCIDA',
          'Sua licença está vencida. Renove a assinatura para ativar o sistema neste computador.',
        )
      throw this.erro(HttpStatus.BAD_REQUEST, 'SEM_LICENCA_ATIVA', 'Nenhuma licença ativa encontrada para este e-mail.')
    }

    // Reutiliza o fluxo de conectar passando a chave da licença.
    // autenticado: identidade já provada por email+senha, então em caso de
    // limite de dispositivos atingido a sessão mais antiga é encerrada em vez de bloquear.
    // servidor: só o backend do servidor da loja chama este login, com o HWID
    // dele — é o que grava (ou troca) o servidor da licença. Sem HWID real não há
    // o que gravar.
    const resultado = await this.dispositivoService.conectar(
      {
        chave:          licenca.chaveAtivacao,
        hwid:           dados.hwid ?? `login-${randomUUID()}`,
        nomeComputador: dados.nomeComputador,
      },
      { autenticado: true, servidor: !!dados.hwid },
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
