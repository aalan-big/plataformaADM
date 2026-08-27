/**
 * ============================================================================
 * NOME DO ARQUIVO: http-exception.filter.ts
 * MÓDULO: CORE/GERAL
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Arquivo de suporte, utilitário ou configuração do módulo CORE/GERAL.
 * 
 * O QUE ELE CONTÉM:
 * - Funções auxiliares, configurações isoladas ou tipos compartilhados.
 * ============================================================================
 */
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'
import { Request, Response } from 'express'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx    = host.switchToHttp()
    const res    = ctx.getResponse<Response>()
    const req    = ctx.getRequest<Request>()

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR

    if (!(exception instanceof HttpException)) {
      console.error('[ERROR]', req.method, req.url, exception)
    }

    const rawResponse = exception instanceof HttpException
      ? exception.getResponse()
      : 'Erro interno do servidor'

    const corpo = typeof rawResponse === 'object' && rawResponse !== null
      ? (rawResponse as Record<string, unknown>)
      : null

    /**
     * Ordem de procura da mensagem: `message`, depois `erro`, depois `mensagem`.
     *
     * Só `message` era consultada, e metade do sistema não usa essa chave: os
     * nossos erros de validação viajam como `{ erro, detalhes }`, e a Focus NFe
     * responde `{ codigo, mensagem }`. Nos dois casos a explicação era jogada
     * fora e trocada por "Erro interno do servidor" — com o status certo (400) e
     * o motivo perdido. Quem recebia isso não tinha como saber o que corrigir, e
     * o texto ainda mandava procurar bug no servidor em vez de no payload.
     */
    const message = typeof rawResponse === 'string'
      ? rawResponse
      : corpo?.message ?? corpo?.erro ?? corpo?.mensagem ?? 'Erro interno do servidor'

    // A lista campo-a-campo do Zod é o que torna um 400 acionável. Sem ela o ERP
    // sabe que recusamos, mas não o quê.
    const detalhes = corpo && 'detalhes' in corpo ? corpo.detalhes : undefined

    // Código de erro estável, quando quem lançou definiu um. Serve para o cliente
    // (ERP local) decidir o que fazer sem parsear texto em português — mensagem se
    // reescreve, `codigo` é contrato. Sem este repasse, o objeto lançado era
    // achatado e o código se perdia aqui.
    const codigo = corpo && 'codigo' in corpo ? corpo.codigo : undefined

    res.status(status).json({
      statusCode: status,
      path:       req.url,
      message,
      ...(codigo !== undefined   ? { codigo }   : {}),
      ...(detalhes !== undefined ? { detalhes } : {}),
    })
  }
}
