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
  criarCobrancaRenovacao,
  findCobrancaPendente,
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

    return this.cobrancaPix({ licenca, plano, meses, valor: opcao.total, rotulo: opcao.label })
  }

  // ── PIX ───────────────────────────────────────────────────────────────────

  private async cobrancaPix(params: {
    licenca: Awaited<ReturnType<RenovacaoCredencialService['resolverLicenca']>>
    plano:   { nome: string }
    meses:   number
    valor:   number
    rotulo:  string
  }) {
    const { licenca, plano, meses, valor, rotulo } = params

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
    const pendente = await findCobrancaPendente({ licencaId: licenca.id, meses, metodo: 'PIX' })

    if (pendente?.gatewayCobrancaId) {
      const completa = await this.garantirQrCode(pendente)
      return this.respostaCobranca(completa, meses)
    }

    // Linha órfã: criada aqui, mas o Asaas nunca chegou a receber a cobrança
    // (queda de rede, chave errada, timeout). Do lado de fora não existe nada
    // para pagar. Reaproveitá-la seria devolver "gerando PIX" para sempre até
    // ela expirar — então é encerrada e uma nova nasce logo abaixo.
    if (pendente) {
      this.logger.warn(`[renovacao] cobrança ${pendente.id} sem correspondente no gateway — cancelada e refeita`)
      await marcarCobrancaStatus(pendente.id, 'CANCELADA')
    }

    const vencimento = new Date()
    vencimento.setDate(vencimento.getDate() + DIAS_ATE_VENCIMENTO_PIX)

    const cobranca = await criarCobrancaRenovacao({
      licencaId: licenca.id,
      clienteId: licenca.clienteId,
      planoId:   licenca.planoId,
      meses,
      valor,
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
  private async garantirQrCode(cobranca: NonNullable<Awaited<ReturnType<typeof findCobrancaRenovacaoById>>>) {
    if (cobranca.copiaECola || !cobranca.gatewayCobrancaId) return cobranca

    try {
      const qr = await this.asaas.buscarQrCodePix(cobranca.gatewayCobrancaId)
      return await anexarDadosDoGateway(cobranca.id, {
        copiaECola:   qr.copiaECola,
        qrCodeBase64: qr.imagemBase64,
        // A validade do QR é a autoritativa: é ela que o banco respeita.
        ...(qr.expiraEm ? { expiraEm: qr.expiraEm } : {}),
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
    return {
      cobrancaId:    c.id,
      metodo:        c.metodo,
      status:        c.status,
      pixCopiaECola: c.copiaECola,
      qrCodeBase64:  c.qrCodeBase64,
      valorCentavos: emCentavos(Number(c.valor)),
      meses,
      expiraEm:      c.expiraEm,
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
