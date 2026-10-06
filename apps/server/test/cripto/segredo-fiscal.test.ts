import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'crypto'
import { cifraDisponivel, cifrar, decifrar } from '../../src/common/cripto/segredo-fiscal'

const CHAVE = randomBytes(32).toString('base64')

describe('segredo-fiscal', () => {
  afterEach(() => { delete process.env.FISCAL_TOKENS_KEY })

  it('cifra e decifra o token', () => {
    process.env.FISCAL_TOKENS_KEY = CHAVE
    const cifrado = cifrar('token-de-producao-123')
    assert.ok(cifrado.startsWith('v1:'))
    assert.equal(cifrado.includes('token-de-producao-123'), false)
    assert.equal(decifrar(cifrado), 'token-de-producao-123')
  })

  it('duas cifras do mesmo texto saem diferentes (IV aleatório)', () => {
    process.env.FISCAL_TOKENS_KEY = CHAVE
    assert.notEqual(cifrar('x'), cifrar('x'))
  })

  it('sem chave: indisponível, e decifrar devolve null em vez de lançar', () => {
    assert.equal(cifraDisponivel(), false)
    assert.throws(() => cifrar('x'))
    assert.equal(decifrar('v1:a:b:c'), null)
  })

  it('chave de tamanho errado conta como ausente', () => {
    process.env.FISCAL_TOKENS_KEY = Buffer.from('curta').toString('base64')
    assert.equal(cifraDisponivel(), false)
  })

  it('valor adulterado ou de outra chave devolve null', () => {
    process.env.FISCAL_TOKENS_KEY = CHAVE
    const cifrado = cifrar('segredo')
    const partes = cifrado.split(':')
    partes[3] = Buffer.from('outra-coisa').toString('base64')
    assert.equal(decifrar(partes.join(':')), null)

    process.env.FISCAL_TOKENS_KEY = randomBytes(32).toString('base64')
    assert.equal(decifrar(cifrado), null)
  })

  it('vazio e texto puro antigo devolvem null', () => {
    process.env.FISCAL_TOKENS_KEY = CHAVE
    assert.equal(decifrar(null), null)
    assert.equal(decifrar(''), null)
    assert.equal(decifrar('token-em-texto-puro'), null)
  })
})
