import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'

@Injectable()
export class FocusNfeService {
  private readonly logger = new Logger(FocusNfeService.name)

  private getBaseUrl(ambiente: number): string {
    // 1 = Produção, 2 = Homologação (padrão)
    return ambiente === 1
      ? 'https://api.focusnfe.com.br/v2'
      : 'https://homologacao.focusnfe.com.br/v2'
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
    const baseUrl = this.getBaseUrl(ambiente)
    const url = `${baseUrl}/nfe?ref=${ref}`

    try {
      this.logger.log(`Enviando NF-e ref "${ref}" para a Focus NFe (ambiente: ${ambiente})`)
      
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(token),
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok) {
        this.logger.warn(`Erro na resposta da Focus NFe para ref "${ref}": HTTP ${response.status} - ${JSON.stringify(data)}`)
        throw new HttpException(
          data || { message: 'Erro desconhecido ao chamar Focus NFe' },
          response.status
        )
      }

      return data
    } catch (error) {
      if (error instanceof HttpException) throw error
      this.logger.error(`Falha de comunicação com Focus NFe para ref "${ref}": ${error instanceof Error ? error.message : error}`)
      throw new HttpException(
        'Falha de comunicação com a Focus NFe.',
        HttpStatus.BAD_GATEWAY
      )
    }
  }

  /**
   * Consulta o status de uma nota fiscal na Focus NFe usando a referência de envio.
   */
  async consultar(token: string, ref: string, ambiente: number): Promise<any> {
    const baseUrl = this.getBaseUrl(ambiente)
    const url = `${baseUrl}/nfe/${ref}`

    try {
      this.logger.log(`Consultando status da NF-e ref "${ref}" (ambiente: ${ambiente})`)

      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(token),
      })

      const data = await response.json()

      if (!response.ok) {
        this.logger.warn(`Erro ao consultar NF-e ref "${ref}": HTTP ${response.status} - ${JSON.stringify(data)}`)
        throw new HttpException(
          data || { message: 'Erro ao consultar nota na Focus NFe' },
          response.status
        )
      }

      return data
    } catch (error) {
      if (error instanceof HttpException) throw error
      this.logger.error(`Falha ao consultar NF-e ref "${ref}": ${error instanceof Error ? error.message : error}`)
      throw new HttpException(
        'Falha de comunicação com a Focus NFe na consulta.',
        HttpStatus.BAD_GATEWAY
      )
    }
  }

  /**
   * Cancela uma NF-e já autorizada.
   */
  async cancelar(token: string, ref: string, justificativa: string, ambiente: number): Promise<any> {
    const baseUrl = this.getBaseUrl(ambiente)
    const url = `${baseUrl}/nfe/${ref}/cancelamento`

    try {
      this.logger.log(`Cancelando NF-e ref "${ref}" (ambiente: ${ambiente})`)

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(token),
        body: JSON.stringify({ justificativa }),
      })

      const data = await response.json()

      if (!response.ok) {
        this.logger.warn(`Erro ao cancelar NF-e ref "${ref}": HTTP ${response.status} - ${JSON.stringify(data)}`)
        throw new HttpException(
          data || { message: 'Erro ao cancelar nota na Focus NFe' },
          response.status
        )
      }

      return data
    } catch (error) {
      if (error instanceof HttpException) throw error
      this.logger.error(`Falha ao cancelar NF-e ref "${ref}": ${error instanceof Error ? error.message : error}`)
      throw new HttpException(
        'Falha de comunicação com a Focus NFe no cancelamento.',
        HttpStatus.BAD_GATEWAY
      )
    }
  }
}
