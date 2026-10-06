import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { HttpException } from '@nestjs/common'
import { FocusNfeService } from '../../src/common/focus-nfe/focus-nfe.service'
import { instalarFetchFalso } from '../apoio/fetch-falso'

const PRODUCAO = 1
const HOMOLOGACAO = 2

describe('FocusNfeService', () => {
  let rede: ReturnType<typeof instalarFetchFalso>
  let focus: FocusNfeService

  beforeEach(() => {
    rede = instalarFetchFalso()
    focus = new FocusNfeService()
  })
  afterEach(() => rede.restaurar())

  describe('host por ambiente', () => {
    it('produção vai para api.focusnfe.com.br', async () => {
      rede.responder(200, { status: 'autorizado' })
      await focus.emitir('tok', 'nfe', 'venda-1', {}, PRODUCAO)
      assert.match(rede.chamadas[0].url, /^https:\/\/api\.focusnfe\.com\.br\/v2\/nfe\?ref=venda-1$/)
    })

    it('homologação vai para homologacao.focusnfe.com.br', async () => {
      rede.responder(200, { status: 'autorizado' })
      await focus.emitir('tok', 'nfce', 'venda-1', {}, HOMOLOGACAO)
      assert.match(rede.chamadas[0].url, /^https:\/\/homologacao\.focusnfe\.com\.br\/v2\/nfce\?ref=venda-1$/)
    })

    it('ambiente desconhecido cai em homologação, nunca em produção', async () => {
      rede.responder(200, {})
      await focus.consultar('tok', 'nfe', 'r', 0)
      assert.match(rede.chamadas[0].url, /homologacao\.focusnfe/)
    })
  })

  it('autentica com Basic: token como usuário e senha vazia', async () => {
    rede.responder(200, {})
    await focus.consultar('meu-token', 'nfe', 'r', PRODUCAO)
    const esperado = 'Basic ' + Buffer.from('meu-token:').toString('base64')
    assert.equal(rede.chamadas[0].headers['Authorization'], esperado)
  })

  it('codifica a ref no caminho', async () => {
    rede.responder(200, {})
    await focus.consultar('tok', 'nfe', 'a b/c', PRODUCAO)
    assert.match(rede.chamadas[0].url, /\/nfe\/a%20b%2Fc\?completa=1$/)
  })

  it('emitir manda o payload JÁ traduzido para a Focus', async () => {
    rede.responder(200, {})
    await focus.emitir('tok', 'nfe', 'r', { emitente: { cnpj: '1', codigo_regime_tributario: 4 } }, PRODUCAO)
    const corpo = rede.chamadas[0].body
    assert.equal(corpo.cnpj_emitente, '1')
    assert.equal(corpo.regime_tributario_emitente, 4)
    assert.equal(corpo.emitente, undefined)
  })

  it('resposta não-2xx vira HttpException com o status da Focus', async () => {
    rede.responder(422, { codigo: 'requisicao_invalida', mensagem: 'campo X' })
    await assert.rejects(
      focus.emitir('tok', 'nfe', 'r', {}, PRODUCAO),
      (e: any) => e instanceof HttpException && e.getStatus() === 422,
    )
  })

  it('falha de rede vira 502, não erro cru', async () => {
    rede.falhar(new Error('ECONNRESET'))
    await assert.rejects(
      focus.consultar('tok', 'nfe', 'r', PRODUCAO),
      (e: any) => e instanceof HttpException && e.getStatus() === 502,
    )
  })

  it('timeout vira 502', async () => {
    const erro = new Error('timeout')
    erro.name = 'TimeoutError'
    rede.falhar(erro)
    await assert.rejects(
      focus.consultar('tok', 'nfe', 'r', PRODUCAO),
      (e: any) => e instanceof HttpException && e.getStatus() === 502,
    )
  })

  describe('buscarEmpresaPorCnpj', () => {
    it('procura no host de produção mesmo para cliente em homologação', async () => {
      rede.responder(200, [{ id: 10, cnpj: '58348941000109' }])
      await focus.buscarEmpresaPorCnpj('conta', '58.348.941/0001-09')
      assert.equal(rede.chamadas[0].url, 'https://api.focusnfe.com.br/v2/empresas?cnpj=58348941000109')
    })

    it('devolve a empresa cujo CNPJ confere, mesmo que não seja a primeira', async () => {
      rede.responder(200, [{ id: 1, cnpj: '11111111000111' }, { id: 2, cnpj: '58348941000109' }])
      const empresa = await focus.buscarEmpresaPorCnpj('conta', '58348941000109')
      assert.equal(empresa.id, 2)
    })

    it('nunca devolve empresa de outro CNPJ se a Focus ignorar o filtro', async () => {
      rede.responder(200, [{ id: 1, cnpj: '11111111000111' }])
      assert.equal(await focus.buscarEmpresaPorCnpj('conta', '58348941000109'), null)
    })

    it('aceita objeto solto no lugar de lista', async () => {
      rede.responder(200, { id: 7, cnpj: '58348941000109' })
      const empresa = await focus.buscarEmpresaPorCnpj('conta', '58348941000109')
      assert.equal(empresa.id, 7)
    })

    it('CNPJ inválido não chama a Focus', async () => {
      assert.equal(await focus.buscarEmpresaPorCnpj('conta', '123'), null)
      assert.equal(rede.chamadas.length, 0)
    })
  })

  it('atualizarEmpresa faz PUT no host de produção com o id codificado', async () => {
    rede.responder(200, { id: 10 })
    await focus.atualizarEmpresa('conta', '10', { habilita_nfe: true })
    assert.equal(rede.chamadas[0].method, 'PUT')
    assert.equal(rede.chamadas[0].url, 'https://api.focusnfe.com.br/v2/empresas/10')
    assert.deepEqual(rede.chamadas[0].body, { habilita_nfe: true })
  })

  it('inutilizar vai para /inutilizacao do recurso, no host do ambiente', async () => {
    rede.responder(200, { status: 'autorizado' })
    await focus.inutilizar('tok', 'nfe', { cnpj: '1', serie: 2, numero_inicial: 1, numero_final: 3, justificativa: 'x'.repeat(15) }, HOMOLOGACAO)
    assert.equal(rede.chamadas[0].url, 'https://homologacao.focusnfe.com.br/v2/nfe/inutilizacao')
    assert.equal(rede.chamadas[0].body.numero_final, 3)
  })
})
