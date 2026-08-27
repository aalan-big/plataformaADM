/**
 * ============================================================================
 * NOME DO ARQUIVO: renovacao.service.ts
 * MÓDULO: RENOVAÇÃO
 * ============================================================================
 * Renovação de assinatura iniciada de dentro do ERP local — PIX e cartão.
 *
 * A regra que atravessa o arquivo inteiro: o ERP PERGUNTA, nós RESPONDEMOS.
 * Ele nunca manda valor, nunca manda data de vencimento, nunca declara que
 * pagou. Ele diz qual licença é e qual período quer; preço, meses e liberação
 * saem daqui. É o que sustenta as invariantes I4 e I5 do contrato do ERP.
 * ============================================================================
 */
import { Injectable, HttpStatus, Logger } from '@nestjs/common'
import {
  findPlanoById,
  findLicencaById,
  criarCobrancaRenovacao,
  findCobrancaPendente,
  modulosCobraveisDaLicenca,
  findCobrancaRenovacaoById,
  anexarDadosDoGateway,
  marcarCobrancaStatus,
  salvarAsaasCustomerId,
  DIAS_ATE_VENCIMENTO_PIX,
} from '@startbig/database'
import {
  criarCobrancaRenovacaoSchema,
  consultarCobrancaSchema,
  PERIODOS_EM_MESES,
} from '@startbig/schemas'
import { AsaasService, AsaasIndisponivelError } from '../../common/asaas/asaas.service'
import { StripeService } from '../../common/stripe/stripe.service'
import { FinanceiroService } from '../financeiro/financeiro.service'
import { RenovacaoCredencialService } from './renovacao-credencial.service'
import { montarOpcoesComMetodos } from '../plano/plano.precos'

/** Reais → centavos. O sistema guarda reais; o ERP fala centavos (I7). */
const emCentavos = (valor: number) => Math.round(valor * 100)

/**
 * Piso entre duas consultas ao gateway para a MESMA cobrança.
 *
 * O ERP faz polling a cada 5s (contrato). Repassar isso ao Asaas seria abuso e
 * nos derrubaria por rate limit. Mas ler só o banco local deixaria o cliente
 * preso se um webhook se perdesse — e "paguei e o sistema continua travado" é o
 * pior desfecho possível desta feature. O meio-termo: o polling lê o banco, e
 * no máximo uma vez a cada 30s pergunta ao gateway. Vive em memória de
 * propósito: é só um freio, e perdê-lo num restart não causa dano nenhum.
 */
const INTERVALO_RECONSULTA_MS = 30_000

@Injectable()
export class RenovacaoService {
  private readonly logger = new Logger(RenovacaoService.name)
  private readonly ultimaConsulta = new Map<string, number>()

  constructor(
    private readonly asaas:       AsaasService,
    private readonly stripe:      StripeService,
    private readonly financeiro:  FinanceiroService,
    private readonly credencial:  RenovacaoCredencialService,
  ) {}

  // ── Vitrine ───────────────────────────────────────────────────────────────

  /**
   * Períodos e preços do plano DESTA licença.
   *
   * Precisa da credencial porque o preço depende do plano que a licença tem —
   * não existe uma tabela global. É também por isso que o ERP não pode ter
   * preço chumbado no código: ele nem saberia qual mostrar.
   */
  async planos(entrada: unknown) {
    const licenca = await this.credencial.resolverLicenca(entrada)
    const plano   = licenca.plano
    if (!plano)
      throw this.credencial.erro(HttpStatus.NOT_FOUND, 'PLANO_INVALIDO', 'Plano da licença não encontrado.')

    const opcoes = montarOpcoesComMetodos(plano, { pixDisponivel: this.asaas.disponivel() })

    return {
      plano:  plano.nome,
      status: licenca.status,
      dataVencimento: licenca.dataVencimento,
      planos: opcoes.map(o => ({
        codigo:        this.codigoDoPeriodo(o.meses),
        nome:          o.label,
        valorCentavos: emCentavos(o.total),
        // `meses`, e não `dias`: a renovação soma MÊS DE CALENDÁRIO, então
        // "30 dias" seria mentira em fevereiro e em todo mês de 31. A data
        // real vai na resposta da cobrança e no /licenca/validar.
        meses:         o.meses,
        desconto:      o.desconto,
        metodos:       o.metodos,
      })),
    }
  }

  private codigoDoPeriodo(meses: number): string {
    const achado = Object.entries(PERIODOS_EM_MESES).find(([, m]) => m === meses)
    return achado?.[0] ?? `MESES_${meses}`
  }

  // ── Criar cobrança ────────────────────────────────────────────────────────

  async criarCobranca(entrada: unknown) {
    const dados   = this.credencial.parseCredencial(criarCobrancaRenovacaoSchema, entrada)
    const licenca = await this.credencial.resolverLicenca(dados)
    const meses   = PERIODOS_EM_MESES[dados.periodo]

    const plano = licenca.plano
    if (!plano)
      throw this.credencial.erro(HttpStatus.NOT_FOUND, 'PLANO_INVALIDO', 'Plano da licença não encontrado.')

    // Anti-cobrança-dupla entre gateways: quem já tem cartão renovando sozinho
    // não pode gerar um PIX por cima — pagaria duas vezes no mesmo mês. A trava
    // já existia no fluxo do Stripe; aqui ela passa a valer para os dois.
    if (licenca.stripeSubscriptionId && await this.stripe.assinaturaAtiva(licenca.stripeSubscriptionId)) {
      throw this.credencial.erro(
        HttpStatus.CONFLICT,
        'ASSINATURA_ATIVA',
        'Esta licença já tem uma assinatura no cartão que renova automaticamente. Não é preciso pagar de novo.',
      )
    }

    const opcao = montarOpcoesComMetodos(plano, { pixDisponivel: this.asaas.disponivel() })
      .find(o => o.meses === meses)

    if (!opcao)
      throw this.credencial.erro(
        HttpStatus.BAD_REQUEST,
        'PLANO_INVALIDO',
        `O plano "${plano.nome}" não é vendido no período ${dados.periodo}.`,
      )

    if (!opcao.metodos.includes(dados.metodo))
      throw this.credencial.erro(
        HttpStatus.BAD_REQUEST,
        'METODO_INDISPONIVEL',
        dados.metodo === 'PIX'
          ? 'PIX não está disponível para este plano/período no momento.'
          : 'Cartão não está disponível para este plano/período no momento.',
      )

    if (dados.metodo === 'CARTAO') return this.checkoutCartao(licenca, meses)

    /**
     * Módulos avulsos entram no valor do PIX.
     *
     * A soma é feita AQUI e não dentro de `montarOpcoes`: aquela função também
     * serve a contratação pública, tela de pagamento e listagem de planos, onde
     * extras não existem — quem está contratando ainda nem tem licença. Somar
     * lá vazaria o valor de um cliente para a vitrine de todos.
     */
    const extras = await modulosCobraveisDaLicenca(licenca.id)
    const totalExtras = extras.reduce((s, e) => s + e.valorMensal, 0) * meses

    return this.cobrancaPix({
      licenca, plano, meses,
      valor:      opcao.total + totalExtras,
      valorPlano: opcao.total,
      extras,
      rotulo:     opcao.label,
      planoId:    licenca.planoId,
    })
  }

  // ── PIX gerado pelo painel (admin) ────────────────────────────────────────

  /**
   * Cobrança PIX criada por quem opera o painel, para mandar ao cliente.
   *
   * Difere do caminho do ERP em dois pontos: a credencial é a sessão de admin
   * (o operador já sabe qual licença é, não precisa de chave+hwid), e ela
   * aceita um plano de DESTINO — é o que permite vender uma troca de plano por
   * PIX, coisa que só o cartão fazia.
   *
   * A licença NÃO muda aqui. Ela muda quando o pagamento cair, no webhook —
   * mesma regra que o checkout do Stripe já seguia. Cliente que não paga não
   * sobe de plano.
   */
  async cobrancaPixAdmin(entrada: { licencaId?: string; meses?: number; planoId?: string }) {
    const licencaId = entrada?.licencaId
    const meses     = Number(entrada?.meses)

    if (!licencaId || ![1, 3, 12].includes(meses))
      throw this.credencial.erro(HttpStatus.BAD_REQUEST, 'DADOS_INVALIDOS', 'Informe a licença e um período de 1, 3 ou 12 meses.')

    const licenca = await findLicencaById(licencaId)
    if (!licenca)
      throw this.credencial.erro(HttpStatus.NOT_FOUND, 'LICENCA_NAO_ENCONTRADA', 'Licença não encontrada.')

    // Mesma trava do fluxo do ERP e do Stripe: assinatura viva no cartão + PIX
    // por cima é o cliente pagando duas vezes no mesmo mês.
    if (licenca.stripeSubscriptionId && await this.stripe.assinaturaAtiva(licenca.stripeSubscriptionId)) {
      throw this.credencial.erro(
        HttpStatus.CONFLICT,
        'ASSINATURA_ATIVA',
        'Esta licença tem assinatura ativa no cartão. Cancele antes de cobrar por PIX, ou o cliente pagará duas vezes.',
      )
    }

    // O preço vem do plano de DESTINO quando há troca — nunca do plano atual.
    // Cobrar pelo plano velho e entregar o novo seria prejuízo silencioso.
    const trocaDePlano = !!entrada.planoId && entrada.planoId !== licenca.planoId
    const planoAlvo    = trocaDePlano ? await findPlanoById(entrada.planoId!) : licenca.plano

    if (!planoAlvo)
      throw this.credencial.erro(HttpStatus.NOT_FOUND, 'PLANO_INVALIDO', 'Plano de destino não encontrado.')
    if ((planoAlvo as { status?: string }).status && (planoAlvo as { status?: string }).status !== 'ATIVO')
      throw this.credencial.erro(HttpStatus.BAD_REQUEST, 'PLANO_INVALIDO', `O plano "${planoAlvo.nome}" está inativo.`)

    const opcao = montarOpcoesComMetodos(planoAlvo as never, { pixDisponivel: this.asaas.disponivel() })
      .find(o => o.meses === meses)

    if (!opcao || !opcao.metodos.includes('PIX'))
      throw this.credencial.erro(
        HttpStatus.BAD_REQUEST,
        'METODO_INDISPONIVEL',
        `O plano "${planoAlvo.nome}" não tem preço próprio cadastrado para ${meses} mês(es), então não pode ser vendido por PIX nesse período.`,
      )

    // Módulos avulsos entram aqui também: numa troca de plano o cliente continua
    // com o que contratou à parte, e a cobrança precisa refletir isso.
    const extras = await modulosCobraveisDaLicenca(licenca.id)
    const totalExtras = extras.reduce((s, e) => s + e.valorMensal, 0) * meses

    const resposta = await this.cobrancaPix({
      licenca,
      plano:      planoAlvo,
      meses,
      valor:      opcao.total + totalExtras,
      valorPlano: opcao.total,
      extras,
      rotulo:     opcao.label,
      planoId:    trocaDePlano ? entrada.planoId! : licenca.planoId,
    })

    // O painel precisa saber que é troca para avisar o operador na tela.
    return { ...resposta, trocaDePlano, plano: planoAlvo.nome }
  }

  // ── PIX ───────────────────────────────────────────────────────────────────

  private async cobrancaPix(params: {
    licenca: Awaited<ReturnType<RenovacaoCredencialService['resolverLicenca']>>
    plano:   { nome: string }
    meses:   number
    /** Total cobrado: plano + módulos avulsos do período. */
    valor:   number
    /**
     * A parte do total que é do PLANO, sem os módulos.
     *
     * Viaja separada porque a comissão do parceiro sai sobre ela: ele indicou o
     * cliente para o plano, não vendeu o módulo. Sem essa separação, um parceiro
     * percentual passaria a receber sobre um produto que você vendeu sozinho,
     * todo mês, para sempre.
     */
    valorPlano?: number
    /** Detalhe dos módulos somados, para o ERP exibir a composição. */
    extras?: { identificador: string; nome: string; valorMensal: number }[]
    rotulo:  string
    /**
     * O plano que está sendo PAGO — nem sempre o plano atual da licença.
     *
     * Numa troca de plano vendida pelo admin, é o plano de DESTINO: a licença
     * só se move quando o pagamento cair, nunca antes. Guardar aqui é o que
     * permite ao webhook saber para onde mover sem consultar nada mais.
     */
    planoId: string
  }) {
    const { licenca, plano, meses, valor, rotulo, planoId } = params
    const extras     = params.extras ?? []
    const valorPlano = params.valorPlano ?? valor

    if (!this.asaas.disponivel())
      throw this.credencial.erro(HttpStatus.SERVICE_UNAVAILABLE, 'METODO_INDISPONIVEL', 'PIX ainda não está habilitado.')

    const cliente = licenca.cliente
    const doc     = (cliente.pf?.cpf ?? cliente.pj?.cnpj ?? '').replace(/\D/g, '')
    const nome    = cliente.pf?.nomeCompleto ?? cliente.pj?.razaoSocial ?? cliente.email

    // O Asaas exige documento para criar cobrança. Falha explícita e cedo, com
    // código próprio, para o ERP poder dizer o que fazer em vez de mostrar um
    // erro cru vindo do gateway.
    if (!doc)
      throw this.credencial.erro(
        HttpStatus.BAD_REQUEST,
        'DOCUMENTO_AUSENTE',
        'O cadastro não tem CPF/CNPJ, exigido para gerar PIX. Fale com o suporte para completar o cadastro.',
      )

    // I3 — dois cliques, ou a tela reaberta, devolvem a MESMA cobrança. Sem
    // isto, cada clique abriria um PIX novo no Asaas e o cliente escolheria
    // qual pagar, com os outros virando cobrança fantasma no painel.
    const pendente = await findCobrancaPendente({ licencaId: licenca.id, meses, metodo: 'PIX', planoId })

    if (pendente?.gatewayCobrancaId) {
      /**
       * Reaproveitar exige confirmar que o outro lado ainda aceita.
       *
       * `status = PENDENTE` aqui só quer dizer que ninguém nos avisou do
       * contrário. A cobrança pode ter sido deletada no painel do Asaas, ou ter
       * passado do `dueDate` — e nos dois casos o copia-e-cola que guardamos
       * continua parecendo bom, mas o banco do cliente recusa. Sem esta
       * conferência, a idempotência vira uma máquina de devolver QR morto: o
       * operador manda, o cliente tenta pagar, ninguém entende por quê.
       */
      if (await this.aindaPagavelNoGateway(pendente.gatewayCobrancaId)) {
        const completa = await this.garantirQrCode(pendente)
        return this.respostaCobranca(completa, meses)
      }

      this.logger.warn(`[renovacao] cobrança ${pendente.id} (${pendente.gatewayCobrancaId}) não é mais pagável no gateway — cancelada e refeita`)
      await marcarCobrancaStatus(pendente.id, 'CANCELADA')
    } else if (pendente) {
      /**
       * Linha órfã: criada aqui, mas o Asaas nunca chegou a receber a cobrança
       * (queda de rede, chave errada, timeout). Do lado de fora não existe nada
       * para pagar. Reaproveitá-la seria devolver "gerando PIX" para sempre até
       * ela expirar — então é encerrada e uma nova nasce logo abaixo.
       *
       * `else if` e não `if`: sem isso, a cobrança que o ramo acima acabou de
       * cancelar caía aqui também e ganhava um segundo aviso dizendo que não
       * tinha correspondente no gateway — o que era falso, ela tinha. Log que
       * mente é pior que log ausente: manda investigar falha de comunicação
       * onde houve cobrança deletada.
       */
      this.logger.warn(`[renovacao] cobrança ${pendente.id} sem correspondente no gateway — cancelada e refeita`)
      await marcarCobrancaStatus(pendente.id, 'CANCELADA')
    }

    const vencimento = new Date()
    vencimento.setDate(vencimento.getDate() + DIAS_ATE_VENCIMENTO_PIX)

    const cobranca = await criarCobrancaRenovacao({
      licencaId: licenca.id,
      clienteId: licenca.clienteId,
      planoId,
      meses,
      valor,
      valorPlano,
      gateway:   'ASAAS',
      metodo:    'PIX',
      // Provisório: substituído pela validade real que o QR devolver.
      expiraEm:  new Date(vencimento.getFullYear(), vencimento.getMonth(), vencimento.getDate(), 23, 59, 59),
    })

    try {
      const customerId = await this.asaas.garantirCliente({
        asaasCustomerId: cliente.asaasCustomerId ?? null,
        nome,
        cpfCnpj:   doc,
        email:     cliente.email,
        telefone:  cliente.pj?.celular ?? cliente.pj?.telefone ?? null,
        clienteId: licenca.clienteId,
      })

      if (customerId !== cliente.asaasCustomerId) {
        await salvarAsaasCustomerId(licenca.clienteId, customerId)
      }

      const criada = await this.asaas.criarCobrancaPix({
        customerId,
        valor,
        vencimento,
        descricao:         `StartBig — ${plano.nome}, ${rotulo}`,
        // O id da NOSSA cobrança. É o que permite ao webhook saber meses e
        // valor sem confiar no payload dele.
        externalReference: cobranca.id,
      })

      await anexarDadosDoGateway(cobranca.id, {
        gatewayCobrancaId: criada.id,
        urlCheckout:       criada.invoiceUrl,
      })

      const comQr = await this.garantirQrCode(
        (await findCobrancaRenovacaoById(cobranca.id))!,
      )
      return this.respostaCobranca(comQr, meses)
    } catch (err) {
      // Fecha a linha que acabou de nascer sem contrapartida no gateway. Sem
      // isto ela ficaria PENDENTE e a idempotência a devolveria nas próximas
      // tentativas, sempre sem copia-e-cola — o cliente veria a tela de PIX
      // carregando indefinidamente e não teria como pagar.
      await marcarCobrancaStatus(cobranca.id, 'CANCELADA').catch(e =>
        this.logger.error(`[renovacao] falha ao cancelar cobrança órfã ${cobranca.id}: ${e?.message ?? e}`),
      )

      if (err instanceof AsaasIndisponivelError) {
        this.logger.error(`[renovacao] Asaas indisponível ao cobrar licença ${licenca.id}: ${err.message}`)
        throw this.credencial.erro(
          HttpStatus.SERVICE_UNAVAILABLE,
          'METODO_INDISPONIVEL',
          'Não foi possível gerar o PIX agora. Tente novamente em alguns instantes.',
        )
      }
      throw err
    }
  }

  /**
   * Busca o copia-e-cola quando ainda não temos.
   *
   * Separado porque roda em dois momentos: logo depois de criar (caminho feliz)
   * e no polling, quando a criação respondeu sem o QR porque o Asaas demorou
   * mais que o teto de I8. É o que permite devolver 201 rápido sem deixar o ERP
   * sem nada para desenhar.
   */
  /**
   * A cobrança ainda pode ser paga do lado do gateway?
   *
   * Falha de rede devolve `true` de propósito. Um Asaas fora do ar não é motivo
   * para cancelar uma cobrança boa e criar outra: o cliente ficaria com dois
   * códigos e o operador sem saber qual mandar. Na dúvida, mantém — o erro
   * aparece na hora de pagar, e é recuperável.
   */
  private async aindaPagavelNoGateway(gatewayCobrancaId: string): Promise<boolean> {
    try {
      const c = await this.asaas.buscarCobranca(gatewayCobrancaId)
      if (this.asaas.ehPago(c.status)) return false          // já paga: não gerar outra
      return c.status === 'PENDING' && !c.deletada
    } catch (err) {
      this.logger.warn(`[renovacao] não deu para conferir ${gatewayCobrancaId} no gateway: ${err instanceof Error ? err.message : err} — mantendo a cobrança`)
      return true
    }
  }

  private async garantirQrCode(cobranca: NonNullable<Awaited<ReturnType<typeof findCobrancaRenovacaoById>>>) {
    if (cobranca.copiaECola || !cobranca.gatewayCobrancaId) return cobranca

    try {
      const qr = await this.asaas.buscarQrCodePix(cobranca.gatewayCobrancaId)

      /**
       * O QR vive MUITO mais que a cobrança — o Asaas devolve validade de cerca
       * de um ano, enquanto o `dueDate` é de um dia. Gravar a validade do QR
       * como nossa fazia a idempotência considerar viva, por um ano, uma
       * cobrança que morreu no dia seguinte: a tela devolvia o mesmo
       * copia-e-cola para sempre e o banco recusava.
       *
       * Vale o que expira PRIMEIRO. `expiraEm` já foi gravado na criação com o
       * fim do dia do vencimento, então só encurtamos se o QR for mais curto
       * ainda.
       */
      const encurtar = qr.expiraEm && cobranca.expiraEm && qr.expiraEm < cobranca.expiraEm

      return await anexarDadosDoGateway(cobranca.id, {
        copiaECola:   qr.copiaECola,
        qrCodeBase64: qr.imagemBase64,
        ...(encurtar ? { expiraEm: qr.expiraEm! } : {}),
      })
    } catch (err) {
      this.logger.warn(`[renovacao] QR ainda indisponível para ${cobranca.id}: ${err instanceof Error ? err.message : err}`)
      return cobranca
    }
  }

  private respostaCobranca(
    c: NonNullable<Awaited<ReturnType<typeof findCobrancaRenovacaoById>>>,
    meses: number,
  ) {
    const total  = Number(c.valor)
    const doPlano = c.valorPlano != null ? Number(c.valorPlano) : total
    const extras = Math.round((total - doPlano) * 100) / 100

    return {
      cobrancaId:    c.id,
      metodo:        c.metodo,
      status:        c.status,
      pixCopiaECola: c.copiaECola,
      qrCodeBase64:  c.qrCodeBase64,
      valorCentavos: emCentavos(total),
      meses,
      expiraEm:      c.expiraEm,

      /**
       * Composição do valor, para o ERP conseguir explicar o total na tela.
       *
       * Um valor que muda sozinho de R$ 59,90 para R$ 109,90 sem justificativa
       * visível é chamado de suporte garantido — o cliente não lembra que
       * contratou um módulo mês passado, e a primeira hipótese dele é erro
       * nosso. `valorModulosCentavos` só é diferente de zero quando há módulo
       * avulso cobrado, então o ERP pode esconder a linha no caso normal.
       */
      valorPlanoCentavos:   emCentavos(doPlano),
      valorModulosCentavos: emCentavos(extras),
    }
  }

  // ── Cartão ────────────────────────────────────────────────────────────────

  /**
   * Cartão continua sendo assinatura recorrente no Stripe — este método só
   * embrulha o fluxo que já existe e já fatura hoje, trocando a credencial de
   * `licencaId` por `chave`+`hwid`. Nenhuma regra de cobrança foi reescrita: o
   * caminho do dinheiro é exatamente o mesmo do painel e do site.
   */
  private async checkoutCartao(
    licenca: Awaited<ReturnType<RenovacaoCredencialService['resolverLicenca']>>,
    meses:   number,
  ) {
    const resultado = await this.financeiro.gerarCobranca({ licencaId: licenca.id, meses })
    return { metodo: 'CARTAO', url: resultado.url, sessionId: resultado.sessionId }
  }

  // ── Consulta de status (polling do ERP) ───────────────────────────────────

  async consultarCobranca(cobrancaId: string, credencial: unknown) {
    const licenca  = await this.credencial.resolverLicenca(
      this.credencial.parseCredencial(consultarCobrancaSchema, credencial),
    )
    let cobranca = await findCobrancaRenovacaoById(cobrancaId)

    // Confere o dono: sem isto, uma chave válida qualquer leria a cobrança de
    // outra pessoa só sabendo o id.
    if (!cobranca || cobranca.licencaId !== licenca.id)
      throw this.credencial.erro(HttpStatus.NOT_FOUND, 'COBRANCA_NAO_ENCONTRADA', 'Cobrança não encontrada para esta licença.')

    if (cobranca.status === 'PENDENTE') {
      cobranca = await this.garantirQrCode(cobranca)
      cobranca = await this.reconsultarGateway(cobranca)
    }

    return {
      cobrancaId:     cobranca.id,
      status:         cobranca.status,
      pagoEm:         cobranca.pagoEm,
      // Só faz sentido depois de pago; a fonte da verdade continua sendo o
      // /licenca/validar, como o próprio contrato do ERP diz.
      dataVencimento: cobranca.status === 'PAGA' ? licenca.dataVencimento : null,
      pixCopiaECola:  cobranca.copiaECola,
      qrCodeBase64:   cobranca.qrCodeBase64,
      valorCentavos:  emCentavos(Number(cobranca.valor)),
      expiraEm:       cobranca.expiraEm,
    }
  }

  /**
   * Rede de segurança para webhook perdido.
   *
   * O webhook continua sendo o caminho normal — é ele que renova a licença.
   * Aqui só perguntamos ao gateway se ele já considera pago; havendo divergência,
   * delegamos ao MESMO processamento do webhook, para não existir uma segunda
   * implementação de "o que fazer quando o dinheiro entra".
   */
  private async reconsultarGateway(
    cobranca: NonNullable<Awaited<ReturnType<typeof findCobrancaRenovacaoById>>>,
  ) {
    if (!cobranca.gatewayCobrancaId || !this.asaas.disponivel()) return cobranca

    const agora = Date.now()
    const ultima = this.ultimaConsulta.get(cobranca.id) ?? 0
    if (agora - ultima < INTERVALO_RECONSULTA_MS) return cobranca
    this.ultimaConsulta.set(cobranca.id, agora)

    try {
      const remota = await this.asaas.buscarCobranca(cobranca.gatewayCobrancaId)
      if (!this.asaas.ehPago(remota.status)) return cobranca

      this.logger.warn(`[renovacao] cobrança ${cobranca.id} paga no gateway sem webhook processado — conciliando`)
      await this.financeiro.confirmarCobrancaAsaas({
        gatewayCobrancaId: remota.id,
        valorPago:         remota.value,
        origem:            'conciliacao',
      })
      return (await findCobrancaRenovacaoById(cobranca.id)) ?? cobranca
    } catch (err) {
      this.logger.warn(`[renovacao] reconsulta ao gateway falhou: ${err instanceof Error ? err.message : err}`)
      return cobranca
    }
  }
}
