/**
 * Confirmação do PIX: webhook e conciliação chegando juntos para a mesma
 * cobrança não podem rodar ao mesmo tempo (ver `confirmarCobrancaAsaas`).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FinanceiroService } from '../../src/features/financeiro/financeiro.service'

/** Só a fila: o corpo da confirmação é trocado por um que mede sobreposição. */
function servicoComFila() {
  const s: any = new (FinanceiroService as any)()
  const log: string[] = []
  let rodando = 0
  let maximo  = 0
  s.confirmarCobrancaAsaasSozinha = async (p: { gatewayCobrancaId: string; origem: string }) => {
    rodando++
    maximo = Math.max(maximo, rodando)
    log.push(`inicio ${p.gatewayCobrancaId} ${p.origem}`)
    await new Promise(r => setTimeout(r, 10))
    log.push(`fim ${p.gatewayCobrancaId} ${p.origem}`)
    rodando--
    if (p.origem === 'falha') throw new Error('falhou')
    return p.origem
  }
  return { s, log, maximo: () => maximo }
}

describe('Financeiro — confirmação do PIX', () => {
  it('a mesma cobrança é processada uma de cada vez', async () => {
    const { s, log, maximo } = servicoComFila()
    const r = await Promise.all([
      s.confirmarCobrancaAsaas({ gatewayCobrancaId: 'pay_1', valorPago: 10, origem: 'webhook' }),
      s.confirmarCobrancaAsaas({ gatewayCobrancaId: 'pay_1', valorPago: 10, origem: 'conciliacao' }),
    ])
    assert.deepEqual(r, ['webhook', 'conciliacao'])
    assert.equal(maximo(), 1)
    assert.deepEqual(log, ['inicio pay_1 webhook', 'fim pay_1 webhook', 'inicio pay_1 conciliacao', 'fim pay_1 conciliacao'])
    assert.equal(s.confirmacoesEmAndamento.size, 0, 'a fila esvazia')
  })

  it('cobranças diferentes não esperam uma pela outra', async () => {
    const { s, maximo } = servicoComFila()
    await Promise.all([
      s.confirmarCobrancaAsaas({ gatewayCobrancaId: 'pay_1', valorPago: 10, origem: 'webhook' }),
      s.confirmarCobrancaAsaas({ gatewayCobrancaId: 'pay_2', valorPago: 10, origem: 'webhook' }),
    ])
    assert.equal(maximo(), 2)
  })

  it('uma falha não trava a próxima da fila', async () => {
    const { s } = servicoComFila()
    const [a, b] = await Promise.allSettled([
      s.confirmarCobrancaAsaas({ gatewayCobrancaId: 'pay_1', valorPago: 10, origem: 'falha' }),
      s.confirmarCobrancaAsaas({ gatewayCobrancaId: 'pay_1', valorPago: 10, origem: 'conciliacao' }),
    ])
    assert.equal(a.status, 'rejected')
    assert.deepEqual(b, { status: 'fulfilled', value: 'conciliacao' })
  })
})
