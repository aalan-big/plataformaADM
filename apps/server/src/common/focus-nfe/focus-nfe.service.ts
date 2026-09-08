import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'

/**
 * Teto de espera por resposta da Focus. O `fetch` do Node não tem timeout
 * próprio: sem isto, uma instabilidade lá deixaria requisições nossas penduradas
 * até o cliente desistir, segurando conexão do pool o tempo todo.
 */
const TIMEOUT_MS = 30_000

/**
 * Recurso da Focus por tipo de documento.
 *
 * NF-e e NFC-e são a MESMA API com caminho diferente — `/nfe` e `/nfce` —, e os
 * corpos de emissão, consulta, cancelamento e inutilização têm o mesmo formato.
 * Por isso os métodos abaixo recebem o recurso em vez de existirem duas vezes:
 * duplicar daria duas cópias do tratamento de timeout, de erro e de encode para
 * envelhecerem em direções diferentes.
 */
export type RecursoFocus = 'nfe' | 'nfce'

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
   * Envia o payload da nota para a Focus NFe autorizar.
   *
   * O corpo vai como veio do ERP, sem poda: a Focus é quem conhece o conjunto
   * completo de campos da SEFAZ, e filtrar aqui significaria derrubar campo
   * obrigatório em silêncio — a nota seria rejeitada lá e o motivo apontaria
   * para o payload de quem não tirou nada.
   */
  async emitir(token: string, recurso: RecursoFocus, ref: string, payload: any, ambiente: number): Promise<any> {
    this.logger.log(`Enviando ${recurso.toUpperCase()} ref "${ref}" para a Focus NFe (ambiente: ${ambiente})`)
    return this.requisitar(
      `${this.getBaseUrl(ambiente)}/${recurso}?ref=${this.encodeRef(ref)}`,
      { method: 'POST', headers: this.getHeaders(token), body: JSON.stringify(payload) },
      `emissão ${recurso} ref "${ref}"`,
    )
  }

  /**
   * Consulta o status de uma nota na Focus NFe usando a referência de envio.
   *
   * `completa=1` porque é a única forma de a Focus devolver o protocolo de
   * autorização: na resposta simples ele não existe em campo nenhum, e sem
   * protocolo o ERP não tem o que imprimir nem o que arquivar.
   */
  async consultar(token: string, recurso: RecursoFocus, ref: string, ambiente: number): Promise<any> {
    this.logger.log(`Consultando status da ${recurso.toUpperCase()} ref "${ref}" (ambiente: ${ambiente})`)
    return this.requisitar(
      `${this.getBaseUrl(ambiente)}/${recurso}/${this.encodeRef(ref)}?completa=1`,
      { method: 'GET', headers: this.getHeaders(token) },
      `consulta ${recurso} ref "${ref}"`,
    )
  }

  /**
   * Cancela uma nota já autorizada.
   */
  async cancelar(token: string, recurso: RecursoFocus, ref: string, justificativa: string, ambiente: number): Promise<any> {
    this.logger.log(`Cancelando ${recurso.toUpperCase()} ref "${ref}" (ambiente: ${ambiente})`)
    return this.requisitar(
      `${this.getBaseUrl(ambiente)}/${recurso}/${this.encodeRef(ref)}/cancelamento`,
      { method: 'POST', headers: this.getHeaders(token), body: JSON.stringify({ justificativa }) },
      `cancelamento ${recurso} ref "${ref}"`,
    )
  }

  /**
   * Inutiliza uma faixa de numeração.
   *
   * Não tem `ref`: a Focus identifica o evento pela própria faixa (CNPJ, série,
   * número inicial e final). É por isso que a idempotência desta operação
   * depende do cabeçalho enviado pelo ERP, e não da referência da nota como no
   * resto do fiscal.
   */
  async inutilizar(
    token: string,
    recurso: RecursoFocus,
    /**
     * Campos extras (o `ano`, por exemplo) seguem junto sem tratamento: quem
     * conhece o conjunto aceito é a Focus, e filtrar aqui é como o payload da
     * emissão perdia campo obrigatório em silêncio.
     */
    dados: { cnpj: string; serie: number; numero_inicial: number; numero_final: number; justificativa: string } & Record<string, unknown>,
    ambiente: number,
  ): Promise<any> {
    this.logger.log(`Inutilizando ${recurso.toUpperCase()} série ${dados.serie}, números ${dados.numero_inicial}-${dados.numero_final} (ambiente: ${ambiente})`)
    return this.requisitar(
      `${this.getBaseUrl(ambiente)}/${recurso}/inutilizacao`,
      { method: 'POST', headers: this.getHeaders(token), body: JSON.stringify(dados) },
      `inutilização ${recurso} série ${dados.serie}`,
    )
  }
}
