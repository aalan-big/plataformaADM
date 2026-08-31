/**
 * ============================================================================
 * NOME DO ARQUIVO: stripe.service.ts
 * MÓDULO: CORE/GERAL
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de CORE/GERAL. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import Stripe from 'stripe'


export type CheckoutResult  = { url: string; sessionId: string }

/** Modulo avulso a cobrar junto do plano. `valorMensal` em reais. */
export type ModuloCobravel = { nome: string; valorMensal: number }

export type EventoParsed =
  | {
      tipo:   'checkout.session.completed'
      dados:  {
        sessionId:      string
        subscriptionId: string | null
        licencaId:      string | null
        planoId:        string | null
        meses:          number
        amountTotal:    number | null
        email:          string | null
        /** Soma MENSAL dos modulos avulsos cobrados nesta assinatura. */
        modulosMensal:  number
      }
    }
  | {
      tipo:  'invoice.payment_succeeded'
      dados: {
        invoiceId:      string
        subscriptionId: string
        amountTotal:    number
        billingReason:  string | null
        licencaId:      string | null
        meses:          number | null
        /** Soma MENSAL dos modulos avulsos cobrados nesta assinatura. */
        modulosMensal:  number
      }
    }
  | {
      tipo:  'invoice.payment_failed'
      dados: { subscriptionId: string; licencaId: string | null }
    }
  | {
      tipo:  'customer.subscription.deleted'
      dados: { subscriptionId: string }
    }
  | { tipo: Exclude<string, 'checkout.session.completed' | 'invoice.payment_succeeded' | 'invoice.payment_failed' | 'customer.subscription.deleted'> }

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly stripe: any

  /** Modo desta instância, derivado da própria chave (não do NODE_ENV — que alguém pode esquecer de setar). */
  private readonly modoLive: boolean

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY não configurada')
    this.stripe   = new Stripe(key)
    // Vale tanto para a chave secreta (sk_) quanto para a restrita (rk_) — as duas
    // existem nos dois modos. Olhar só para "sk_live" classificaria uma rk_live como
    // TEST, e aí o guard abaixo recusaria todo evento real com 400.
    this.modoLive = /^(sk|rk)_live_/.test(key)
    this.logger.log(`StripeService iniciado — modo ${this.modoLive ? 'LIVE (dinheiro real)' : 'TEST'}`)
  }

  /**
   * Transforma modulos avulsos em itens de linha recorrentes do Stripe.
   *
   * Duas coisas aqui nao podem ser chutadas, e por isso o Price do plano e
   * BUSCADO em vez de deduzido:
   *
   * 1. Numa assinatura, todos os itens precisam ter o MESMO ciclo. Se o item do
   *    plano cobra a cada 3 meses e o do modulo a cada 1, o Stripe recusa a
   *    sessao inteira — e o cliente ve o erro, nao nos.
   *
   * 2. O valor do modulo e MENSAL, mas a linha cobra por ciclo. Quantos meses
   *    tem o ciclo sai do proprio `recurring` do Price, e nao do parametro
   *    `meses`: se um dia o Price trimestral tiver sido criado no Stripe de um
   *    jeito diferente do que o nosso banco assume, quem manda e o Stripe —
   *    senao cobrariamos 3x um modulo numa cobranca mensal.
   *
   * Produto ad-hoc (`product_data`) em vez de Price pre-criado de proposito: o
   * valor do modulo e negociado por cliente, entao um Price fixo no catalogo
   * nao conseguiria representar "este paga 40, aquele paga 25".
   */
  private async linhasDeModulos(
    stripePriceIdDoPlano: string,
    extras: ModuloCobravel[],
  ) {
    // Sem anotacao de retorno: a tipagem do pacote nao expoe
    // Stripe.Checkout.SessionCreateParams nesta versao, e o inferido ja e
    // conferido no ponto de uso, dentro do sessions.create.
    if (extras.length === 0) return []

    const price = await this.stripe.prices.retrieve(stripePriceIdDoPlano)
    const rec   = price.recurring
    if (!rec) throw new BadRequestException('O Price do plano não é recorrente — não dá para anexar módulo a ele.')

    const mesesDoCiclo =
      rec.interval === 'year'  ? 12 * (rec.interval_count ?? 1)
      : rec.interval === 'month' ? (rec.interval_count ?? 1)
      : 1 // semanal/diario nao existe no nosso catalogo; cobra 1 mes e nao quebra

    return extras.map(e => ({
      price_data: {
        currency:     price.currency,
        product_data: { name: `${e.nome} (módulo avulso)` },
        unit_amount:  Math.round(e.valorMensal * mesesDoCiclo * 100),
        recurring:    { interval: rec.interval, interval_count: rec.interval_count ?? 1 },
      },
      quantity: 1,
    }))
  }

  async criarCheckoutSession(dados: {
    meses:         number
    licencaId:     string
    email:         string
    stripePriceId: string   // Price recorrente pré-criado no catálogo do Stripe
    /** Domínio de retorno. Já validado por quem chama — ver validarOrigem(). */
    appUrl?:       string
    /**
     * Plano a aplicar QUANDO o pagamento for confirmado. Viaja na metadata para
     * o webhook saber o que fazer — é assim que a troca de plano paga funciona
     * sem alterar nada antes de o dinheiro entrar.
     */
    planoId?:      string
    /**
     * Modulos avulsos desta licenca. Entram como itens de linha proprios, e nao
     * somados ao valor do plano, para o cliente ver o que esta pagando na tela
     * do Stripe e na fatura — "R$ 89,90" viraria "R$ 129,90" sem explicacao.
     */
    extras?:       ModuloCobravel[]
  }): Promise<CheckoutResult> {
    // Quem compra em assine.startbig.com.br tem de voltar para assine., não para
    // o painel: trocar de domínio no meio do pagamento parece golpe.
    const appUrl = dados.appUrl ?? process.env.APP_URL ?? 'http://localhost:3000'
    const label  = dados.meses === 1 ? '1 mês' : `${dados.meses} meses`

    /**
     * `modulosMensal` na metadata nao e informacao decorativa: e a unica forma
     * de o webhook saber, meses depois, QUANTO daquela fatura era modulo.
     *
     * A comissao do parceiro incide so sobre o plano. Deduzir isso na hora do
     * pagamento exigiria adivinhar se a assinatura tinha o modulo — e uma
     * assinatura antiga, criada antes desta mudanca, cobra so o plano. Chutar
     * "subtrai o modulo" ali roubaria comissao de quem indicou o cliente.
     * Gravado aqui, o numero e o que foi realmente cobrado, e nao um palpite.
     */
    const modulosMensal = (dados.extras ?? []).reduce((soma, e) => soma + e.valorMensal, 0)

    const metadados: Record<string, string> = {
      licencaId:     dados.licencaId,
      meses:         String(dados.meses),
      modulosMensal: String(modulosMensal),
      ...(dados.planoId ? { planoId: dados.planoId } : {}),
    }

    const linhasExtras = await this.linhasDeModulos(dados.stripePriceId, dados.extras ?? [])

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: dados.stripePriceId, quantity: 1 }, ...linhasExtras],
      mode:           'subscription',
      customer_email: dados.email,
      // Endereço de cobrança é exigência de nota fiscal. Coletar aqui, e não no
      // nosso formulário, porque nesta tela o cliente já está preenchendo dados
      // de pagamento — o mesmo campo antes do cartão derrubaria conversão.
      billing_address_collection: 'required',
      success_url:    `${appUrl}/pagamento/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:     `${appUrl}/pagamento/cancelado`,
      metadata:       metadados,
      // A metadata precisa ir na ASSINATURA também: as renovações automáticas
      // (invoice.payment_succeeded) só enxergam a subscription, não a session.
      subscription_data: { metadata: metadados },
    })

    this.logger.log(`Checkout Session (assinatura) criada: ${session.id} → licença ${dados.licencaId} (${label}, price ${dados.stripePriceId}${linhasExtras.length > 0 ? `, +${linhasExtras.length} módulo(s)` : ''})`)
    return { url: session.url!, sessionId: session.id }
  }

  parsearEvento(rawBody: Buffer, signature: string): EventoParsed {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET não configurada')

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, secret)

    // Guard de ambiente: a chave define o modo desta instância. Um evento de test mode
    // chegando numa instância live (ou o contrário) significa endpoint/secret trocado na
    // configuração — recusa ANTES de tocar em qualquer dado. Falha alto de propósito:
    // aparece como entrega com erro no painel do Stripe em vez de passar despercebido.
    if (event.livemode !== this.modoLive) {
      throw new Error(
        `Evento em modo ${event.livemode ? 'LIVE' : 'TEST'} recebido numa instância ${this.modoLive ? 'LIVE' : 'TEST'} — recusado. Confira STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET deste ambiente.`,
      )
    }

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as any
      return {
        tipo:  'checkout.session.completed',
        dados: {
          sessionId:      s.id,
          subscriptionId: typeof s.subscription === 'string' ? s.subscription : null,
          licencaId:      s.metadata?.licencaId   ?? null,
          // Presente quando o checkout foi gerado para trocar de plano: só então
          // a licença muda de plano, e só se o pagamento vier.
          planoId:        s.metadata?.planoId     ?? null,
          meses:          parseInt(s.metadata?.meses ?? '1') || 1,
          amountTotal:    s.amount_total,
          modulosMensal:  Number(s.metadata?.modulosMensal ?? 0) || 0,
          email:          s.customer_email,
        },
      }
    }

    if (event.type === 'invoice.payment_succeeded') {
      const inv = event.data.object as any
      const { subscriptionId, licencaId, meses, modulosMensal } = this.extrairDadosFatura(inv)
      return {
        tipo:  'invoice.payment_succeeded',
        dados: {
          invoiceId:     inv.id,
          subscriptionId,
          amountTotal:   inv.amount_paid / 100,
          billingReason: inv.billing_reason ?? null,
          licencaId,
          meses,
          modulosMensal,
        },
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object as any
      const { subscriptionId, licencaId } = this.extrairDadosFatura(inv)
      return { tipo: 'invoice.payment_failed', dados: { subscriptionId, licencaId } }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as any
      return { tipo: 'customer.subscription.deleted', dados: { subscriptionId: sub.id } }
    }

    return { tipo: event.type }
  }

  /**
   * Extrai assinatura + metadata (licencaId/meses) de uma fatura, lidando com o
   * novo formato da API 2025+ (dahlia): `invoice.subscription` foi movido para
   * `invoice.parent.subscription_details`. Mantém fallback para o campo antigo.
   */
  private extrairDadosFatura(inv: any): { subscriptionId: string; licencaId: string | null; meses: number | null; modulosMensal: number } {
    const subDetails = inv.parent?.subscription_details ?? null
    const rawSub     = subDetails?.subscription ?? inv.subscription
    const subscriptionId = typeof rawSub === 'string' ? rawSub : (rawSub?.id ?? '')
    const metadata   = subDetails?.metadata ?? {}
    return {
      subscriptionId,
      licencaId: metadata.licencaId ?? null,
      meses:     parseInt(metadata.meses ?? '') || null,
      // Ausente = assinatura criada antes de o modulo entrar no cartao: zero, e
      // a comissao segue sobre o total, que e o que de fato foi cobrado.
      modulosMensal: Number(metadata.modulosMensal ?? 0) || 0,
    }
  }

  async buscarMetadadosSubscription(subscriptionId: string): Promise<{ licencaId: string | null; meses: number }> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    return {
      licencaId: sub.metadata?.licencaId ?? null,
      meses:     parseInt(sub.metadata?.meses ?? '1') || 1,
    }
  }

  /**
   * Anexa um modulo avulso a uma assinatura JA existente.
   *
   * Sem isto a venda avulsa so funcionaria para quem assinasse depois de ganhar
   * o modulo — o caso raro. O comum e o contrario: o cliente ja paga no cartao
   * ha meses e agora quer o modulo. A assinatura dele nao muda sozinha, entao a
   * cobranca nunca aconteceria.
   *
   * `proration_behavior: 'none'` de proposito: o modulo passa a ser cobrado no
   * PROXIMO ciclo, sem cobranca proporcional agora. E a escolha conservadora —
   * errar para o lado de nao cobrar o cliente por um pedaco de mes que ele nem
   * pediu e melhor que uma cobranca surpresa no cartao dele no mesmo dia.
   *
   * A metadata e reescrita junto porque e dela que o webhook tira a base da
   * comissao. Item novo sem atualizar o numero faria o parceiro comissionar
   * sobre o modulo a partir do ciclo seguinte.
   */
  async adicionarModuloNaSubscription(
    subscriptionId: string,
    modulo: ModuloCobravel,
  ): Promise<{ itemId: string }> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    const rec = sub.items?.data?.[0]?.price?.recurring
    if (!rec) throw new BadRequestException('Assinatura sem item recorrente — não dá para anexar módulo.')

    const currency = sub.items.data[0].price.currency
    const mesesDoCiclo =
      rec.interval === 'year'  ? 12 * (rec.interval_count ?? 1)
      : rec.interval === 'month' ? (rec.interval_count ?? 1)
      : 1

    const item = await this.stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price_data: {
        currency,
        product_data: { name: `${modulo.nome} (módulo avulso)` },
        unit_amount:  Math.round(modulo.valorMensal * mesesDoCiclo * 100),
        recurring:    { interval: rec.interval, interval_count: rec.interval_count ?? 1 },
      },
      quantity: 1,
      proration_behavior: 'none',
    })

    const atual = Number(sub.metadata?.modulosMensal ?? 0) || 0
    await this.stripe.subscriptions.update(subscriptionId, {
      metadata: { ...sub.metadata, modulosMensal: String(atual + modulo.valorMensal) },
    })

    this.logger.log(`[modulo] ${modulo.nome} anexado à assinatura ${subscriptionId} (item ${item.id}, R$ ${modulo.valorMensal}/mês).`)
    return { itemId: item.id }
  }

  /**
   * Tira o modulo da assinatura. Chamado ao revogar — sem isto o Stripe
   * continuaria cobrando todo mes por um acesso que o cliente ja nao tem, que e
   * o unico erro pior que nao cobrar.
   */
  async removerModuloDaSubscription(
    subscriptionId: string,
    itemId: string,
    valorMensal: number,
  ): Promise<void> {
    await this.stripe.subscriptionItems.del(itemId, { proration_behavior: 'none' })

    const sub   = await this.stripe.subscriptions.retrieve(subscriptionId)
    const atual = Number(sub.metadata?.modulosMensal ?? 0) || 0
    await this.stripe.subscriptions.update(subscriptionId, {
      metadata: { ...sub.metadata, modulosMensal: String(Math.max(0, atual - valorMensal)) },
    })

    this.logger.log(`[modulo] item ${itemId} removido da assinatura ${subscriptionId}.`)
  }

  async cancelarSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId)
    this.logger.log(`Subscription cancelada: ${subscriptionId}`)
  }

  /**
   * Diz se uma assinatura ainda está "viva" no Stripe (cobrando). Usado para
   * impedir a criação de uma 2ª assinatura (cobrança duplicada) quando já existe
   * uma ativa. Se a assinatura não existir mais, retorna false (não bloqueia).
   *
   * Só o "não existe" (resource_missing — inclui a assinatura de outro modo/conta,
   * típico depois da virada test → live) vira false. Qualquer outra falha — chave
   * errada, timeout, indisponibilidade — ESTOURA, de propósito: antes um catch
   * mudo transformava erro de rede em "não tem assinatura", e quem decide a partir
   * disso ou dava o plano de graça ou criava uma 2ª assinatura em cima da que já
   * cobrava. Na dúvida sobre dinheiro, é melhor falhar alto do que adivinhar.
   */
  async assinaturaAtiva(subscriptionId: string): Promise<boolean> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
      return ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)
    } catch (err) {
      const code = (err as { code?: string; statusCode?: number })?.code
      const http = (err as { statusCode?: number })?.statusCode
      if (code === 'resource_missing' || http === 404) return false

      this.logger.error(`Falha ao consultar a assinatura ${subscriptionId} no Stripe: ${err instanceof Error ? err.message : err}`)
      throw new BadRequestException(
        'Não foi possível confirmar a situação da assinatura no Stripe agora. Tente de novo em alguns instantes — nada foi alterado.',
      )
    }
  }

  /**
   * Descobre o período de cobrança de uma assinatura (mensal/trimestral/anual),
   * a partir do intervalo do preço atual. Usado na troca de plano para escolher
   * o Price equivalente do novo plano (mantém o mesmo período de cobrança).
   */
  async periodoDaSubscription(subscriptionId: string): Promise<'mensal' | 'trimestral' | 'anual'> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    const rec = sub.items?.data?.[0]?.price?.recurring
    const interval = rec?.interval
    const count    = rec?.interval_count ?? 1
    if (interval === 'year') return 'anual'
    if (interval === 'month' && count === 3) return 'trimestral'
    return 'mensal'
  }

  /**
   * Garante que o catálogo do Stripe reflita um plano do nosso banco: acha ou cria o
   * produto pelo nome, reaplica a descrição (que o cliente LÊ no checkout) e, para
   * cada período com preço definido, acha ou cria o Price correspondente.
   *
   * Existe porque Price no Stripe é imutável: editar o preço no painel muda só o
   * valor exibido: o Stripe continua cobrando o Price antigo até alguém apontar o
   * plano para um novo. Este método fecha esse buraco em uma operação.
   *
   * Não apaga nem arquiva Price antigo — assinatura viva nele continua válida, e é
   * assim que o cliente que assinou por R$ 89,90 mantém o preço que contratou.
   */
  async sincronizarCatalogo(dados: {
    nome:      string
    descricao: string | null
    metadata?: Record<string, string>
    periodos:  { periodo: 'mensal' | 'trimestral' | 'anual'; valorCentavos: number | null }[]
  }): Promise<{
    produtoId:     string
    produtoCriado: boolean
    resultados:    { periodo: string; priceId: string | null; valor: number | null; acao: 'criado' | 'reaproveitado' | 'sem-preco' }[]
  }> {
    const RECORRENCIA = {
      mensal:     { interval: 'month', interval_count: 1 },
      trimestral: { interval: 'month', interval_count: 3 },
      anual:      { interval: 'year',  interval_count: 1 },
    } as const

    const jaExiste = await this.acharProdutoPorNome(dados.nome)

    const produto = jaExiste
      ? await this.stripe.products.update(jaExiste.id, {
          description: dados.descricao ?? undefined,
          ...(dados.metadata ? { metadata: dados.metadata } : {}),
        })
      : await this.stripe.products.create({
          name:        dados.nome,
          description: dados.descricao ?? undefined,
          ...(dados.metadata ? { metadata: dados.metadata } : {}),
        })

    const resultados: { periodo: string; priceId: string | null; valor: number | null; acao: 'criado' | 'reaproveitado' | 'sem-preco' }[] = []

    for (const { periodo, valorCentavos } of dados.periodos) {
      // Período sem preço no plano não deve ter Price: é o que faz a tela de
      // pagamento parar de oferecer uma opção que o plano não precifica mais.
      if (valorCentavos == null || valorCentavos <= 0) {
        resultados.push({ periodo, priceId: null, valor: null, acao: 'sem-preco' })
        continue
      }

      const rec       = RECORRENCIA[periodo]
      const existente = await this.acharPrice(produto.id, valorCentavos, rec)

      const price = existente ?? (await this.stripe.prices.create({
        product:     produto.id,
        currency:    'brl',
        unit_amount: valorCentavos,
        recurring:   rec,
      }))

      resultados.push({
        periodo,
        priceId: price.id,
        valor:   valorCentavos / 100,
        acao:    existente ? 'reaproveitado' : 'criado',
      })
    }

    this.logger.log(`Catálogo sincronizado (${this.modoLive ? 'LIVE' : 'TEST'}): ${dados.nome} → produto ${produto.id}`)
    return { produtoId: produto.id, produtoCriado: !jaExiste, resultados }
  }

  /** Produto ATIVO com o nome exato — evita duplicar o catálogo a cada sincronização. */
  private async acharProdutoPorNome(nome: string) {
    for await (const p of this.stripe.products.list({ active: true, limit: 100 })) {
      if (p.name === nome) return p
    }
    return null
  }

  /** Price ATIVO do produto com exatamente o mesmo valor, moeda e periodicidade. */
  private async acharPrice(
    produtoId: string,
    valorCentavos: number,
    rec: { interval: 'month' | 'year'; interval_count: number },
  ) {
    for await (const p of this.stripe.prices.list({ product: produtoId, active: true, limit: 100 })) {
      if (
        p.unit_amount === valorCentavos &&
        p.currency === 'brl' &&
        p.recurring?.interval === rec.interval &&
        (p.recurring?.interval_count ?? 1) === rec.interval_count
      ) return p
    }
    return null
  }

  /** Diz se esta instância está operando com chave live — usado para avisar na UI. */
  get emModoLive(): boolean {
    return this.modoLive
  }

  /**
   * Troca o Price de uma assinatura existente (mesma assinatura, cartão já salvo).
   * - quando = 'imediato'     → upgrade: cobra a diferença proporcional AGORA (proration).
   * - quando = 'fim_do_ciclo' → downgrade: sem cobrança/estorno agora; o novo preço
   *   passa a valer só na próxima fatura (fim do período já pago).
   */
  async atualizarPrecoSubscription(
    subscriptionId: string,
    novoPriceId:    string,
    quando:         'imediato' | 'fim_do_ciclo',
  ): Promise<void> {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    const itemId = sub.items?.data?.[0]?.id
    if (!itemId) throw new BadRequestException('Assinatura sem item de cobrança — não foi possível trocar o plano.')

    await this.stripe.subscriptions.update(subscriptionId, {
      items:              [{ id: itemId, price: novoPriceId }],
      proration_behavior: quando === 'imediato' ? 'always_invoice' : 'none',
    })

    this.logger.log(`Plano da subscription ${subscriptionId} trocado para ${novoPriceId} (${quando})`)
  }
}
