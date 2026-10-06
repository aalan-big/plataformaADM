/**
 * Montagem comum dos testes do `FiscalService`: uma Focus falsa que grava as
 * chamadas e um cliente cadastrado no banco em memória.
 */
import { HttpException } from '@nestjs/common'
import { FiscalService } from '../../src/features/fiscal/fiscal.service'
import { reiniciarBanco, tabelas } from './prisma-falso'

export const LICENCA = 'lic-1'
export const CLIENTE = 'cli-1'
export const PLANO = 'plano-1'
export const CNPJ = '58348941000109'

type Chamada = { metodo: string; args: any[] }

/** Falha HTTP como a `FocusNfeService.requisitar` produz. */
export const falhaHttp = (status: number, corpo: unknown = { mensagem: 'erro' }) =>
  new HttpException(corpo as any, status)

export class FocusFalsa {
  chamadas: Chamada[] = []
  /** Por método: lista de respostas (valor ou erro), consumida em ordem. */
  roteiro: Record<string, unknown[]> = {}

  quando(metodo: string, ...respostas: unknown[]) {
    ;(this.roteiro[metodo] ??= []).push(...respostas)
    return this
  }

  private async responder(metodo: string, args: any[]) {
    this.chamadas.push({ metodo, args })
    const fila = this.roteiro[metodo]
    if (!fila || fila.length === 0) throw new Error(`Focus falsa: ${metodo} sem resposta roteirizada`)
    const r = fila.shift()
    if (r instanceof Error) throw r
    return r
  }

  chamadasDe(metodo: string) {
    return this.chamadas.filter(c => c.metodo === metodo)
  }

  emitir(...a: any[])               { return this.responder('emitir', a) }
  consultar(...a: any[])            { return this.responder('consultar', a) }
  cancelar(...a: any[])             { return this.responder('cancelar', a) }
  cartaCorrecao(...a: any[])        { return this.responder('cartaCorrecao', a) }
  inutilizar(...a: any[])           { return this.responder('inutilizar', a) }
  buscarEmpresaPorCnpj(...a: any[]) { return this.responder('buscarEmpresaPorCnpj', a) }
  atualizarEmpresa(...a: any[])     { return this.responder('atualizarEmpresa', a) }
  criarEmpresa(...a: any[])         { return this.responder('criarEmpresa', a) }
}

/**
 * Banco zerado com uma licença. `ficha` = campos da `EmpresaFiscalConfig`
 * (sobrescrevem o padrão); `null` = cliente sem ficha fiscal, o caso do Celso
 * antes de alguém criar a ficha no admin.
 */
export function prepararCenario(ficha: Record<string, any> | null = {}) {
  reiniciarBanco()
  tabelas.licenca.push({ id: LICENCA, clienteId: CLIENTE, planoId: PLANO })
  if (ficha !== null) {
    tabelas.empresaFiscalConfig.push({
      id: 'cfg-1',
      clienteId: CLIENTE,
      cnpj: CNPJ,
      razaoSocial: '58.348.941 CELSO PEREZ RIBEIRA',
      inscricaoEstadual: '151815563116',
      ambiente: 1,
      certificadoStatus: 'AUSENTE',
      certificadoVencimento: null,
      focusEmpresaId: null,
      focusEmpresaToken: null,
      focusTokenProducao: null,
      focusTokenHomologacao: null,
      cscConfigurado: false,
      ...ficha,
    })
  }
  const focus = new FocusFalsa()
  const servico = new FiscalService(focus as any)
  return { focus, servico, ficha: () => tabelas.empresaFiscalConfig[0] }
}

/** Confere status e `codigo` do corpo de uma HttpException. */
export function ehHttp(status: number, codigo?: string) {
  return (e: any) => {
    if (!(e instanceof HttpException)) return false
    if (e.getStatus() !== status) return false
    if (codigo === undefined) return true
    const corpo = e.getResponse() as any
    return corpo?.codigo === codigo
  }
}
