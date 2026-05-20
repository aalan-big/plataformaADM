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

    const message = typeof rawResponse === 'string'
      ? rawResponse
      : typeof rawResponse === 'object' && rawResponse !== null && 'message' in rawResponse
        ? (rawResponse as Record<string, unknown>).message
        : 'Erro interno do servidor'

    res.status(status).json({
      statusCode: status,
      path:       req.url,
      message,
    })
  }
}
