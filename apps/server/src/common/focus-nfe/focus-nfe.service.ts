import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'

/**
 * Teto de espera por resposta da Focus. O `fetch` do Node não tem timeout
 * próprio: sem isto, uma instabilidade lá deixaria requisições nossas penduradas
 * até o cliente desistir, segurando conexão do pool o tempo todo.
 */
const TIMEOUT_MS = 30_000

@Injectable()
export class FocusNfeService {
  private readonly logger = new Logger(FocusNfeService.name)

  private getBaseUrl(ambiente: number): string {
    // 1 = Produção, 2 = Homologação (padrão)
    return ambiente === 1
      ? 'https://api.focusnfe.com.br/v2'
      : 'https://homologacao.focusnfe.com.br/v2'
  }

  /**
   * A `ref` é interpolada em caminho e query string das chamadas abaixo. Ela já
   * chega validada por `refNotaSchema` no controller, mas o encode fica aqui
   * também: quem montar uma URL nova neste arquivo herda a proteção sem precisar
   * lembrar dela.
   */
  private encodeRef(ref: string): string {
    return encodeURIComponent(ref)
  }

  private async requisitar(url: string, init: RequestInit, contexto: string): Promise<any> {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      const expirou = error instanceof Error && error.name === 'TimeoutError'
      this.logger.error(`Falha de comunicação com Focus NFe (${contexto}): ${expirou ? `sem resposta em ${TIMEOUT_MS}ms` : error instanceof Error ? error.message : error}`)
      throw new HttpException(`Falha de comunicação com a Focus NFe (${contexto}).`, HttpStatus.BAD_GATEWAY)
    }

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null

    if (!response.ok) {
      // Só o campo de erro vai para o log. O corpo inteiro traz dados do
      // destinatário da nota (nome, CPF/CNPJ, endereço) e log não é lugar disso.
      const motivo = data?.mensagem ?? data?.erro ?? data?.codigo ?? 'sem detalhe'
      this.logger.warn(`Focus NFe recusou (${contexto}): HTTP ${response.status} - ${motivo}`)
      throw new HttpException(data ?? { message: 'Erro desconhecido ao chamar Focus NFe' }, response.status)
    }

    return data
  }

  private getHeaders(token: string) {
    // A Focus NFe usa Basic Auth com o Token no usuário e senha em branco.
    const credentials = Buffer.from(`${token}:`).toString('base64')
    return {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  }

  /**
   * Envia o payload da NF-e para a Focus NFe autorizar.
   */
  async emitir(token: string, ref: string, payload: any, ambiente: number): Promise<any> {
    this.logger.log(`Enviando NF-e ref "${ref}" para a Focus NFe (ambiente: ${ambiente})`)
    return this.requisitar(
      `${this.getBaseUrl(ambiente)}/nfe?ref=${this.encodeRef(ref)}`,
      { method: 'POST', headers: this.getHeaders(token), body: JSON.stringify(payload) },
      `emissão ref "${ref}"`,
    )
  }

  /**
   * Consulta o status de uma nota fiscal na Focus NFe usando a referência de envio.
   */
  async consultar(token: string, ref: string, ambiente: number): Promise<any> {
    this.logger.log(`Consultando status da NF-e ref "${ref}" (ambiente: ${ambiente})`)
    return this.requisitar(
      `${this.getBaseUrl(ambiente)}/nfe/${this.encodeRef(ref)}`,
      { method: 'GET', headers: this.getHeaders(token) },
      `consulta ref "${ref}"`,
    )
  }

  /**
   * Cancela uma NF-e já autorizada.
   */
  async cancelar(token: string, ref: string, justificativa: string, ambiente: number): Promise<any> {
    this.logger.log(`Cancelando NF-e ref "${ref}" (ambiente: ${ambiente})`)
    return this.requisitar(
      `${this.getBaseUrl(ambiente)}/nfe/${this.encodeRef(ref)}/cancelamento`,
      { method: 'POST', headers: this.getHeaders(token), body: JSON.stringify({ justificativa }) },
      `cancelamento ref "${ref}"`,
    )
  }
}
