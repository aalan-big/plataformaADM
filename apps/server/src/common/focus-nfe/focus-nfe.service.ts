import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'
import { traduzirPayloadParaFocus } from './focus-payload.mapper'

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

      /**
       * O `erros` também vai para o log, e é o unico pedaço do corpo que vai.
       *
       * A recusa de schema da Focus diz "verifique o detalhamento dos erros" e
       * o detalhamento é justamente este array — sem ele, o log manda conferir
       * uma coisa que ele mesmo descartou, e o suporte fica adivinhando qual
       * campo do payload está errado.
       *
       * É a lista de validação da emissora: nomes de campo e o que há de errado
       * com eles. Não é o corpo da nota — o destinatário e os valores continuam
       * fora do log, que é o que a regra acima protege.
       */
      if (Array.isArray(data?.erros) && data.erros.length > 0) {
        const detalhe = data.erros
          .map((e: any) =>
            typeof e === 'string'
              ? e
              : [e?.campo, e?.mensagem ?? e?.erro].filter(Boolean).join(': ') || JSON.stringify(e),
          )
          .join(' | ')
        this.logger.warn(`Focus NFe detalhou (${contexto}): ${detalhe}`)
      }

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
   * O corpo é TRADUZIDO, nunca podado. O ERP fala em objetos aninhados
   * (`emitente{}`, `destinatario{}`, `totais{}`) e a Focus só entende o formato
   * plano (`cnpj_emitente`, `nome_destinatario`, `valor_total`); sem a tradução
   * ela recebe três objetos desconhecidos e nenhum campo de emitente,
   * destinatário ou totais. Fora esse rearranjo, tudo o que o ERP mandou segue
   * adiante: a Focus é quem conhece o conjunto completo de campos da SEFAZ, e
   * filtrar aqui derrubaria campo obrigatório em silêncio — a nota seria
   * rejeitada lá e o motivo apontaria para o payload de quem não tirou nada.
   *
   * A tradução mora AQUI, na fronteira com a Focus, e não no `FiscalService`:
   * assim nenhum caminho de emissão consegue passar por fora dela, e o dia em
   * que trocarmos de emissora este é o arquivo que muda.
   */
  async emitir(token: string, recurso: RecursoFocus, ref: string, payload: any, ambiente: number): Promise<any> {
    this.logger.log(`Enviando ${recurso.toUpperCase()} ref "${ref}" para a Focus NFe (ambiente: ${ambiente})`)
    return this.requisitar(
      `${this.getBaseUrl(ambiente)}/${recurso}?ref=${this.encodeRef(ref)}`,
      {
        method: 'POST',
        headers: this.getHeaders(token),
        body: JSON.stringify(traduzirPayloadParaFocus(payload)),
      },
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

  /**
   * Grava o certificado A1 no cadastro da empresa dentro da Focus.
   *
   * Duas coisas separam este método de todos os acima.
   *
   * PRIMEIRA: o token. Emitir, consultar, cancelar e inutilizar usam o token DA
   * EMPRESA (`focusEmpresaToken`). O cadastro de empresas é da CONTA — é o token
   * do painel da Focus, o mesmo que lista todas as empresas. Mandar o token da
   * empresa aqui devolve 401, e um 401 solto chega ao lojista parecendo recusa
   * do certificado dele.
   *
   * SEGUNDA: o host. As notas vão para `homologacao.focusnfe.com.br` quando o
   * ambiente é 2, mas o CADASTRO da empresa vive em `api.focusnfe.com.br`. A
   * empresa é uma só, e é ela que devolve os dois tokens — `token_producao` e
   * `token_homologacao` —, que é como o ambiente se escolhe depois, na emissão.
   * Por isso `getBaseUrl(ambiente)` não aparece aqui.
   *
   * O corpo carrega o certificado e a senha. Nada dele entra em log: o
   * `requisitar` só registra o campo de erro da resposta, e a linha de log abaixo
   * não toca em `dados`.
   */
  /**
   * Acha a empresa no cadastro da Focus pelo CNPJ.
   *
   * Existe para o `focusEmpresaId` deixar de ser digitação. Ele é um dado
   * DERIVÁVEL — temos o CNPJ na ficha e o token de parceiro no ambiente —, e
   * pedir que um humano copie um número de um painel para outro só cria uma
   * forma nova de errar: enquanto ele faltava, o upload de certificado
   * respondia 501 e o lojista lia "a plataforma ainda não recebe certificado",
   * que aponta para o lado errado do cano.
   *
   * A Focus filtra por CNPJ na própria query, então não há paginação a
   * percorrer nem lista inteira a trazer. Devolve `null` quando não existe
   * empresa com esse CNPJ — que é resposta legítima, e diferente de erro: quer
   * dizer que o cadastro ainda precisa ser feito no painel da Focus.
   *
   * Como todo o cadastro de empresas, isto vive em `api.focusnfe.com.br`
   * mesmo quando o cliente emite em homologação.
   */
  async buscarEmpresaPorCnpj(tokenDaConta: string, cnpj: string): Promise<any | null> {
    const digitos = String(cnpj || '').replace(/\D/g, '')
    if (digitos.length !== 14) return null

    this.logger.log(`Procurando empresa de CNPJ ${digitos} no cadastro da Focus NFe`)

    const resposta = await this.requisitar(
      `https://api.focusnfe.com.br/v2/empresas?cnpj=${encodeURIComponent(digitos)}`,
      { method: 'GET', headers: this.getHeaders(tokenDaConta) },
      `busca da empresa de CNPJ ${digitos}`,
    )

    // A rota devolve um ARRAY (até 50 por página). Aceitamos objeto solto
    // também: custa uma linha e evita que uma mudança de formato lá vire um
    // "empresa não encontrada" aqui, que mandaria o admin cadastrar de novo uma
    // empresa que já existe.
    const lista = Array.isArray(resposta) ? resposta : resposta ? [resposta] : []

    /**
     * Conferimos o CNPJ de novo, mesmo tendo filtrado por ele.
     *
     * O que volta daqui decide em qual empresa o certificado do cliente vai ser
     * gravado. Confiar no filtro remoto e pegar `lista[0]` significaria que uma
     * mudança de comportamento na Focus — filtro ignorado, por exemplo — grava
     * o certificado de um cliente na empresa de outro.
     */
    const empresa = lista.find(
      (e: any) => String(e?.cnpj || '').replace(/\D/g, '') === digitos,
    )

    return empresa ?? null
  }

  async atualizarEmpresa(
    tokenDaConta: string,
    empresaId: string,
    dados: Record<string, unknown>,
  ): Promise<any> {
    this.logger.log(`Atualizando cadastro da empresa ${empresaId} na Focus NFe`)
    return this.requisitar(
      `https://api.focusnfe.com.br/v2/empresas/${encodeURIComponent(empresaId)}`,
      { method: 'PUT', headers: this.getHeaders(tokenDaConta), body: JSON.stringify(dados) },
      `atualização da empresa ${empresaId}`,
    )
  }
}
