/**
 * ============================================================================
 * NOME DO ARQUIVO: erp-contratacao.service.ts
 * MÓDULO: ERP / CONTRATAÇÃO PÚBLICA
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Orquestra a contratação de quem chega pelo site sem ser cliente ainda.
 *
 * POR QUE É UMA OPERAÇÃO SÓ:
 * O checkout do Stripe carrega `metadata.licencaId`, e é esse campo que o
 * webhook usa para achar a licença e renovar. Sem cliente e licença criados
 * ANTES, o pagamento chega órfão e cai no alarme de "pagamento descartado".
 * Cadastro e cobrança viajam juntos justamente para não existir um estado
 * intermediário em que o cliente pagou e não há a quem creditar.
 * ============================================================================
 */
import { Injectable, BadRequestException, NotFoundException, UnauthorizedException, Logger } from '@nestjs/common'
import { ZodError, z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma, findPlanoById, updateLicenca } from '@startbig/database'
import { DispositivoService, autoCadastroSchema } from '../dispositivos/dispositivo.service'
import { FinanceiroService } from '../financeiro/financeiro.service'
import { PlanoService } from '../plano/plano.service'
import { montarOpcoes } from '../plano/plano.precos'

/** Cadastro do auto-cadastro + o que o cliente escolheu comprar. */
export const contratarSchema = autoCadastroSchema.extend({
  planoId: z.string().uuid('planoId inválido.'),
  meses:   z.number().int().refine(m => [1, 3, 12].includes(m), 'Período inválido — use 1, 3 ou 12.'),
})

export const identificarSchema = z.object({
  email: z.string().email('E-mail inválido.'),
})

/** Quem já é cliente não redigita nome e documento — prova quem é com a senha. */
export const contratarExistenteSchema = z.object({
  email:   z.string().email('E-mail inválido.'),
  senha:   z.string().min(1, 'Informe sua senha.'),
  planoId: z.string().uuid('planoId inválido.'),
  meses:   z.number().int().refine(m => [1, 3, 12].includes(m), 'Período inválido — use 1, 3 ou 12.'),
})

@Injectable()
export class ErpContratacaoService {
  private readonly logger = new Logger(ErpContratacaoService.name)

  constructor(
    private readonly dispositivoService: DispositivoService,
    private readonly financeiroService:  FinanceiroService,
    private readonly planoService:       PlanoService,
  ) {}

  /** Vitrine da página pública. */
  async planosPublicos() {
    return { data: await this.planoService.listarPublicos() }
  }

  /**
   * Diz se o e-mail já tem conta, para o formulário se adaptar: cadastro
   * completo para quem é novo, só a senha para quem já é cliente.
   *
   * Isso revela se um endereço tem conta aqui. É o tradeoff que praticamente
   * todo SaaS aceita, porque a alternativa — descobrir o problema só depois de
   * preencher tudo — custa conversão. O throttler global limita varredura.
   */
  async identificar(body: unknown) {
    let dados: z.infer<typeof identificarSchema>
    try {
      dados = identificarSchema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }

    const cliente = await prisma.cliente.findFirst({
      where:  { email: dados.email.toLowerCase() },
      select: { id: true, senhaHash: true },
    })

    return {
      data: {
        existe: !!cliente,
        // Cliente antigo pode não ter senha. Dizer "senha incorreta" para quem
        // nunca criou uma manda a pessoa procurar erro onde não existe.
        precisaCriarSenha: !!cliente && !cliente.senhaHash,
      },
    }
  }

  /**
   * Contratação de quem JÁ É CLIENTE: valida e-mail e senha e gera o checkout
   * da licença que ele já tem.
   *
   * Não usa o /erp/auth/login de propósito: aquele fluxo abre sessão de
   * dispositivo, e o cliente estaria ocupando uma vaga de usuário da própria
   * licença só por ter pago pelo navegador.
   */
  async contratarExistente(body: unknown, origem?: string) {
    let dados: z.infer<typeof contratarExistenteSchema>
    try {
      dados = contratarExistenteSchema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }

    const cliente = await prisma.cliente.findFirst({
      where:   { email: dados.email.toLowerCase() },
      include: {
        // A mais recente, qualquer status: quem está vencido é justamente
        // quem quer pagar. Filtrar por ATIVA deixaria esse cliente de fora.
        dispositivos: { orderBy: { criadoEm: 'desc' }, take: 1, include: { plano: true } },
      },
    })

    // Mensagem igual para e-mail inexistente e senha errada — não confirma
    // qual dos dois falhou para quem estiver testando credenciais.
    if (!cliente)            throw new UnauthorizedException('E-mail ou senha incorretos.')
    if (!cliente.senhaHash)
      throw new BadRequestException('Sua conta ainda não tem senha definida. Verifique seu e-mail para criar uma, ou fale com o suporte.')

    const senhaValida = await bcrypt.compare(dados.senha, cliente.senhaHash)
    if (!senhaValida)        throw new UnauthorizedException('E-mail ou senha incorretos.')

    const licenca = cliente.dispositivos[0]
    if (!licenca)
      throw new BadRequestException('Não encontramos nenhuma licença nesta conta. Fale com o suporte.')

    // Evita cobrar um plano e entregar outro: se a licença dele está em outro
    // plano, o valor exibido na tela não seria o valor cobrado.
    if (licenca.planoId !== dados.planoId)
      throw new BadRequestException(
        `Sua licença está no plano "${licenca.plano?.nome ?? 'atual'}". Para mudar de plano, fale com o suporte.`,
      )

    const cobranca = await this.financeiroService.gerarCobranca(
      { licencaId: licenca.id, meses: dados.meses },
      origem,
    )

    this.logger.log(`[contratacao] cliente existente ${dados.email} → ${dados.meses} mês(es) na licença ${licenca.id}`)

    return {
      msg:  'Identificado. Redirecionando para o pagamento.',
      data: { url: cobranca.url, licencaId: licenca.id },
    }
  }

  async contratar(body: unknown, origem?: string) {
    let dados: z.infer<typeof contratarSchema>
    try {
      dados = contratarSchema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }

    // O plano vem do navegador, então é conferido aqui e não aceito de graça:
    // sem esta checagem, bastaria trocar o id no request para comprar um plano
    // de canal interno pelo preço dele.
    const plano = await findPlanoById(dados.planoId)
    if (!plano)                    throw new NotFoundException('Plano não encontrado.')
    if (plano.status !== 'ATIVO')  throw new BadRequestException('Este plano não está disponível para contratação.')
    if (!(plano as { publico?: boolean }).publico)
      throw new BadRequestException('Este plano não está disponível para contratação online.')

    const periodoValido = montarOpcoes(plano).some(o => o.meses === dados.meses)
    if (!periodoValido)
      throw new BadRequestException('Período indisponível para este plano.')

    // 1. Cria cliente + licença (trial de 14 dias). Os dias do trial não se
    //    perdem: a renovação soma o período pago por cima do que ainda resta.
    const cadastro = await this.dispositivoService.autoCadastro({
      documento:   dados.documento,
      nomeOuRazao: dados.nomeOuRazao,
      email:       dados.email,
      senha:       dados.senha,
      telefone:    dados.telefone,
      celular:     dados.celular,
    })

    // O autoCadastro devolve os campos na raiz (msg, clienteId, licencaId, ...),
    // não dentro de `data`. Ler do lugar errado aqui criaria o cliente e falharia
    // logo depois — o pior desfecho possível, porque o e-mail já estaria em uso
    // e ele não conseguiria tentar de novo.
    const licencaId = cadastro?.licencaId
    if (!licencaId) {
      this.logger.error('[contratacao] auto-cadastro não devolveu licencaId')
      throw new BadRequestException('Não foi possível concluir o cadastro. Tente novamente.')
    }

    // 2. O auto-cadastro carimba o plano padrão; aqui vale o que foi escolhido.
    await updateLicenca(licencaId, { planoId: plano.id })

    // 3. Checkout. Falhando aqui, o cadastro permanece: o cliente já consegue
    //    entrar no ERP e usar o trial, e pode pagar depois pelo próprio sistema.
    //    Perder o cadastro seria pior do que ficar sem a cobrança.
    try {
      const cobranca = await this.financeiroService.gerarCobranca(
        { licencaId, meses: dados.meses },
        origem,
      )

      this.logger.log(`[contratacao] ${dados.email} → ${plano.nome} (${dados.meses} mês(es)) — licença ${licencaId}`)

      return {
        msg:  'Cadastro criado. Redirecionando para o pagamento.',
        data: { url: cobranca.url, licencaId },
      }
    } catch (err) {
      this.logger.error(`[contratacao] cadastro ${licencaId} criado, mas o checkout falhou: ${err instanceof Error ? err.message : err}`)
      throw new BadRequestException(
        'Seu cadastro foi criado, mas não conseguimos abrir o pagamento agora. ' +
        'Acesse o sistema com o e-mail e a senha que você cadastrou e conclua a assinatura por lá, ou fale com o suporte.',
      )
    }
  }
}
