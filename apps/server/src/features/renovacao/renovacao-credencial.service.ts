/**
 * ============================================================================
 * NOME DO ARQUIVO: renovacao-credencial.service.ts
 * MÓDULO: RENOVAÇÃO
 * ============================================================================
 * Resolve `chave` + `hwid` numa licença, para as rotas de renovação do ERP.
 *
 * Existe separado porque é a peça que faz a invariante I1 do contrato do ERP
 * funcionar: **cobrar tem que funcionar com a licença VENCIDA**. Quem precisa
 * pagar é justamente quem está vencido — um gate que exija licença válida
 * prende o cliente do lado de fora, sem conseguir nem nos dar dinheiro.
 * ============================================================================
 */
import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { ZodError } from 'zod'
import { findLicencaByChave } from '@startbig/database'
import { credencialErpSchema } from '@startbig/schemas'

type LicencaResolvida = NonNullable<Awaited<ReturnType<typeof findLicencaByChave>>>

@Injectable()
export class RenovacaoCredencialService {
  private readonly logger = new Logger(RenovacaoCredencialService.name)

  /**
   * Erro no formato que o ERP consome: `codigo` é contrato e é nele que o app
   * ramifica; a mensagem é para o usuário final e pode ser reescrita a qualquer
   * momento sem quebrar ninguém.
   */
  erro(status: HttpStatus, codigo: string, mensagem: string): HttpException {
    return new HttpException({ codigo, message: mensagem }, status)
  }

  parseCredencial<T>(schema: { parse: (x: unknown) => T }, entrada: unknown): T {
    try {
      return schema.parse(entrada)
    } catch (e) {
      if (e instanceof ZodError)
        throw this.erro(HttpStatus.BAD_REQUEST, 'DADOS_INVALIDOS', 'Dados inválidos na requisição.')
      throw e
    }
  }

  /**
   * Carrega a licença a partir da credencial e aplica o único gate que existe
   * aqui: bloqueio administrativo.
   *
   * O que NÃO barra, de propósito:
   *  - VENCIDA  — é o caso principal (I1). Barrar aqui seria trancar o cliente
   *               do lado de fora do próprio pagamento.
   *  - AGUARDANDO — licença criada e ainda não ativada também pode ser paga.
   *
   * O que barra:
   *  - BLOQUEADA / SUSPENSA / REVOGADA — decisão administrativa nossa. Nesses
   *    casos pagar não resolve, e deixar o cliente pagar seria pior do que
   *    recusar: ele gastaria e continuaria sem acesso, e nós teríamos que
   *    devolver. O contrato do ERP separa esse caso justamente por isso.
   */
  async resolverLicenca(entrada: unknown): Promise<LicencaResolvida> {
    const dados   = this.parseCredencial(credencialErpSchema, entrada)
    const licenca = await findLicencaByChave(dados.chave)

    if (!licenca) {
      // Sem detalhar se foi a chave ou o hwid: para quem chama, é o mesmo caso,
      // e distinguir só ajudaria quem está tentando adivinhar chave.
      this.logger.warn(`[renovacao] credencial não resolvida (hwid=${dados.hwid ?? '-'})`)
      throw this.erro(
        HttpStatus.NOT_FOUND,
        'LICENCA_NAO_ENCONTRADA',
        'Licença não encontrada para esta chave de ativação.',
      )
    }

    const BLOQUEIOS: Record<string, string> = {
      BLOQUEADA: 'Licença bloqueada. Pagar não reativa — fale com o suporte.',
      SUSPENSA:  'Licença suspensa. Pagar não reativa — fale com o suporte.',
      REVOGADA:  'Licença revogada. Pagar não reativa — fale com o suporte.',
    }

    const bloqueio = BLOQUEIOS[licenca.status as string]
    if (bloqueio)
      throw this.erro(HttpStatus.FORBIDDEN, 'LICENCA_BLOQUEADA', bloqueio)

    return licenca
  }
}
