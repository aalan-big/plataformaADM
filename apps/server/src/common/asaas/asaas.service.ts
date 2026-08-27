/**
 * ============================================================================
 * NOME DO ARQUIVO: asaas.service.ts
 * MÓDULO: COMMON/ASAAS
 * ============================================================================
 * Cliente HTTP do Asaas — o gateway que cobra por PIX.
 *
 * Convive com o Stripe de propósito: cartão continua sendo assinatura
 * recorrente lá, PIX é cobrança avulsa aqui. São dois modelos diferentes de
 * dinheiro, e unificá-los num gateway só custaria a renovação automática do
 * cartão, que é a receita mais previsível que existe.
 *
 * NADA aqui é obrigatório para o boot. Sem `ASAAS_API_KEY`, `disponivel()`
 * devolve false e o PIX some das opções — a API inteira continua de pé. Ver a
 * nota em `conferirTokenAsaas` (financeiro.service) sobre por que o Asaas não
 * entra em `validarSegredosProducao`.
 * ============================================================================
 */
import { Injectable, Logger } from '@nestjs/common'

const SANDBOX  = 'https://api-sandbox.asaas.com/v3'
const PRODUCAO = 'https://api.asaas.com/v3'

/**
 * Teto de espera por chamada. Existe por causa da invariante I8 do contrato do
 * ERP (responder em menos de 5s): o app usa timeouts curtos com o servidor de
 * licença, e um Asaas lento não pode virar tela travada na loja. Estourando, a
 * cobrança é devolvida sem o copia-e-cola e o ERP o busca no polling.
 */
const TIMEOUT_MS = 8000

export type CobrancaAsaas = {
  id:         string
  status:     string
  invoiceUrl: string | null
  value:      number
  /** Apagada no painel do Asaas. Segue respondendo PENDING, mas não aceita pagamento. */
  deletada?:  boolean
}

export type QrCodePix = {
  copiaECola:   string
  imagemBase64: string | null
  expiraEm:     Date | null
}

export class AsaasIndisponivelError extends Error {}

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name)

  private get chave(): string {
    return process.env.ASAAS_API_KEY?.trim() ?? ''
  }

  /**
   * A chave decide o ambiente sozinha: sandbox começa com `$aact_hmlg_`,
   * produção com `$aact_prod_`. Derivar em vez de pedir uma segunda variável
   * elimina de vez a combinação que mais dói — chave de produção apontando para
   * a URL de sandbox, ou o contrário: cobrança criada no ambiente errado e
   * cliente pagando de verdade num lugar de teste. `ASAAS_BASE_URL` fica como
   * escape manual, para o dia em que o Asaas mudar o domínio.
   */
  private get baseUrl(): string {
    const manual = process.env.ASAAS_BASE_URL?.trim()
    if (manual) return manual.replace(/\/$/, '')
    return this.ehProducao() ? PRODUCAO : SANDBOX
  }

  /** Sem chave, o PIX simplesmente não é oferecido — não é erro, é ausência. */
  disponivel(): boolean {
    return this.chave.length > 0
  }

  /** True quando a chave em uso é de produção (cobra dinheiro de verdade). */
  ehProducao(): boolean {
    return this.chave.startsWith('$aact_prod_')
  }

  private async chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    if (!this.disponivel())
      throw new AsaasIndisponivelError('ASAAS_API_KEY não configurada.')

    let resposta: Response
    try {
      resposta = await fetch(`${this.baseUrl}${caminho}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          access_token:   this.chave,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      // Timeout e queda de rede caem aqui. A chave nunca vaza na mensagem.
      throw new AsaasIndisponivelError(
        `Falha de rede ao falar com o Asaas (${caminho}): ${err instanceof Error ? err.message : err}`,
      )
    }

    const corpo = await resposta.text()
    if (!resposta.ok) {
      this.logger.error(`[asaas] ${init.method ?? 'GET'} ${caminho} -> ${resposta.status}: ${corpo.slice(0, 500)}`)
      throw new AsaasIndisponivelError(`Asaas respondeu ${resposta.status} em ${caminho}.`)
    }

    return corpo ? (JSON.parse(corpo) as T) : ({} as T)
  }

  // ── Clientes ──────────────────────────────────────────────────────────────

  /**
   * Devolve o id do cliente no Asaas, criando se ainda não existir.
   *
   * A ordem importa: primeiro o id que já guardamos, depois a busca por
   * documento, e só então criar. Sem a busca do meio, um cliente cadastrado no
   * Asaas por fora — ou por um deploy que perdeu o `asaasCustomerId` — viraria
   * um segundo cadastro, e o histórico dele nasceria partido em dois.
   */
  async garantirCliente(dados: {
    asaasCustomerId: string | null
    nome:            string
    cpfCnpj:         string
    email:           string
    telefone?:       string | null
    clienteId:       string
  }): Promise<string> {
    if (dados.asaasCustomerId) return dados.asaasCustomerId

    const doc = dados.cpfCnpj.replace(/\D/g, '')

    try {
      const busca  = await this.chamar<{ data?: Array<{ id: string }> }>(`/customers?cpfCnpj=${doc}`)
      const achado = busca.data?.[0]?.id
      if (achado) {
        this.logger.log(`[asaas] cliente reaproveitado ${achado} para ${dados.clienteId}`)
        return achado
      }
    } catch (err) {
      // A busca é otimização, não pré-requisito: falhando, seguimos para criar.
      this.logger.warn(`[asaas] busca de cliente falhou, seguindo para criação: ${err instanceof Error ? err.message : err}`)
    }

    const criado = await this.chamar<{ id: string }>('/customers', {
      method: 'POST',
      body:   JSON.stringify({
        name:              dados.nome,
        cpfCnpj:           doc,
        email:             dados.email,
        ...(dados.telefone ? { mobilePhone: dados.telefone.replace(/\D/g, '') } : {}),
        externalReference: dados.clienteId,
      }),
    })

    this.logger.log(`[asaas] cliente criado ${criado.id} para ${dados.clienteId}`)
    return criado.id
  }

  // ── Cobranças ─────────────────────────────────────────────────────────────

  /**
   * Cria a cobrança PIX.
   *
   * `externalReference` é o id da NOSSA CobrancaRenovacao, nunca o da licença.
   * É esse detalhe que permite ao webhook descobrir meses e valor sem acreditar
   * no que o gateway mandou — ele diz apenas "a cobrança X caiu".
   */
  async criarCobrancaPix(dados: {
    customerId:        string
    valor:             number
    vencimento:        Date
    descricao:         string
    externalReference: string
  }): Promise<CobrancaAsaas> {
    const pago = await this.chamar<{ id: string; status: string; invoiceUrl?: string; value: number }>('/payments', {
      method: 'POST',
      body:   JSON.stringify({
        customer:          dados.customerId,
        billingType:       'PIX',
        value:             dados.valor,
        dueDate:           dados.vencimento.toISOString().slice(0, 10), // YYYY-MM-DD
        description:       dados.descricao.slice(0, 500),
        externalReference: dados.externalReference,
      }),
    })

    return { id: pago.id, status: pago.status, invoiceUrl: pago.invoiceUrl ?? null, value: pago.value }
  }

  /** Copia-e-cola + imagem do QR. O ERP desenha o QR a partir do copia-e-cola. */
  async buscarQrCodePix(paymentId: string): Promise<QrCodePix> {
    const qr = await this.chamar<{ encodedImage?: string; payload: string; expirationDate?: string }>(
      `/payments/${paymentId}/pixQrCode`,
    )
    return {
      copiaECola:   qr.payload,
      imagemBase64: qr.encodedImage ?? null,
      expiraEm:     qr.expirationDate ? new Date(qr.expirationDate) : null,
    }
  }

  async buscarCobranca(paymentId: string): Promise<CobrancaAsaas> {
    const p = await this.chamar<{ id: string; status: string; invoiceUrl?: string; value: number; deleted?: boolean }>(
      `/payments/${paymentId}`,
    )
    /**
     * `deleted` importa tanto quanto o status: uma cobrança apagada no painel
     * do Asaas CONTINUA respondendo `PENDING`, mas o QR dela já não é aceito
     * pelo banco. Sem este campo, "pendente" parecia sinônimo de "pagável".
     */
    return { id: p.id, status: p.status, invoiceUrl: p.invoiceUrl ?? null, value: p.value, deletada: p.deleted === true }
  }

  /** Status do Asaas que significam "o dinheiro entrou". */
  ehPago(status: string): boolean {
    return status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH'
  }
}
