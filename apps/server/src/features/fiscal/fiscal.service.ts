import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { prisma } from '@startbig/database'
import { FocusNfeService } from '../../common/focus-nfe/focus-nfe.service'

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name)

  constructor(private readonly focusNfeService: FocusNfeService) {}

  private mapResultado(data: any, ambiente: number): any {
    let status = 'erro'
    const statusFocus = data.status || ''

    if (statusFocus === 'autorizado') {
      status = 'autorizado'
    } else if (
      statusFocus === 'processando_autorizacao' ||
      statusFocus === 'processando'
    ) {
      status = 'processando'
    } else if (statusFocus === 'cancelado') {
      status = 'cancelado'
    }

    const domain = ambiente === 1
      ? 'https://api.focusnfe.com.br'
      : 'https://homologacao.focusnfe.com.br'

    const urlPdf = data.caminho_danfe_pdf
      ? (data.caminho_danfe_pdf.startsWith('http') ? data.caminho_danfe_pdf : `${domain}${data.caminho_danfe_pdf}`)
      : null

    const urlXml = data.caminho_xml_nota_fiscal
      ? (data.caminho_xml_nota_fiscal.startsWith('http') ? data.caminho_xml_nota_fiscal : `${domain}${data.caminho_xml_nota_fiscal}`)
      : null

    return {
      status,
      chave_acesso: data.chave_nfe || data.chave || null,
      protocolo: data.protocolo || null,
      numero: data.numero ? Number(data.numero) : null,
      serie: data.serie ? Number(data.serie) : null,
      url_pdf: urlPdf,
      url_xml: urlXml,
      codigo_sefaz: data.codigo_sefaz ? Number(data.codigo_sefaz) : null,
      mensagem_sefaz: data.mensagem_sefaz || null,
    }
  }

  private async getEmpresaConfig(licencaId: string) {
    const licenca = await prisma.licenca.findUnique({
      where: { id: licencaId },
      select: { clienteId: true },
    })

    if (!licenca) {
      throw new NotFoundException('Licença não encontrada no servidor.')
    }

    const config = await prisma.empresaFiscalConfig.findUnique({
      where: { clienteId: licenca.clienteId },
    })

    if (!config) {
      throw new NotFoundException('Empresa não possui configuração fiscal ativa.')
    }

    if (!config.focusEmpresaToken) {
      throw new BadRequestException('Token de emissão da Focus NFe pendente de configuração.')
    }

    return config
  }

  async emitir(licencaId: string, ref: string, payload: any) {
    const config = await this.getEmpresaConfig(licencaId)

    // Trava de Idempotência: Confere na Focus se esta ref já foi enviada
    try {
      this.logger.log(`Verificando se ref "${ref}" já existe na Focus NFe para garantir idempotência`)
      const notaExistente = await this.focusNfeService.consultar(
        config.focusEmpresaToken,
        ref,
        config.ambiente
      )
      if (notaExistente && notaExistente.status !== 'nao_encontrado') {
        this.logger.log(`Ref "${ref}" já emitida anteriormente. Retornando status existente.`)
        return this.mapResultado(notaExistente, config.ambiente)
      }
    } catch (e) {
      // Ignora erro 404 (não encontrado) pois é o esperado para novas emissões
      const isNotFound = e instanceof Error && (e.message.includes('404') || e.message.includes('not_found'))
      if (!isNotFound) {
        this.logger.warn(`Erro ao checar idempotência para ref "${ref}": ${e instanceof Error ? e.message : e}`)
      }
    }

    const res = await this.focusNfeService.emitir(
      config.focusEmpresaToken,
      ref,
      payload,
      config.ambiente
    )

    return this.mapResultado(res, config.ambiente)
  }

  async consultar(licencaId: string, ref: string) {
    const config = await this.getEmpresaConfig(licencaId)
    const res = await this.focusNfeService.consultar(
      config.focusEmpresaToken,
      ref,
      config.ambiente
    )
    return this.mapResultado(res, config.ambiente)
  }

  async cancelar(licencaId: string, ref: string, justificativa: string) {
    if (!justificativa || justificativa.length < 15) {
      throw new BadRequestException('A justificativa de cancelamento deve conter no mínimo 15 caracteres.')
    }

    const config = await this.getEmpresaConfig(licencaId)
    const res = await this.focusNfeService.cancelar(
      config.focusEmpresaToken,
      ref,
      justificativa,
      config.ambiente
    )
    return this.mapResultado(res, config.ambiente)
  }
}
