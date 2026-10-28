/**
 * Franquia de notas: 70 por mês somando NF-e, NFC-e e NFS-e; acima disso o
 * cartão paga R$ 1 por nota (fechamento no dia 1º) e o PIX trava. Mais o teto
 * de segurança do cartão, a nota repetida e os avisos.
 *
 * O relógio fica parado em novembro de 2026, primeiro mês em que a regra vale.
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { tabelas } from '../apoio/prisma-falso'
import { prepararCenario, falhaHttp, ehHttp, LICENCA, CNPJ } from '../apoio/cenario-fiscal'
import { FiscalExcedenteService, competenciaAnterior } from '../../src/features/fiscal/fiscal-excedente.service'
import { assinaturaDaNota } from '../../src/features/fiscal/fiscal-franquia.service'

const NOV = '2026-11'
const NAO_ENCONTRADA = falhaHttp(404, { codigo: 'nao_encontrado' })
const AUTORIZADA = { status: 'autorizado', status_sefaz: '100', mensagem_sefaz: 'Autorizado o uso da NF-e', numero: '2', serie: '1' }

const nfe = (extra: Record<string, unknown> = {}) => ({
  emitente: { cnpj: CNPJ }, cnpj_destinatario: '11222333000181',
  items: [{ codigo_produto: 'P1', quantidade_comercial: 2, valor_unitario_comercial: 10 }],
  ...extra,
})

/** Notas de produção já emitidas no mês, por tipo. */
function consumo(tipoDocumento: string, emitidas: number, cotaExtra = 0, licencaId = LICENCA, competencia = NOV) {
  tabelas.consumoFiscal.push({ licencaId, competencia, ambiente: 1, tipoDocumento, emitidas, canceladas: 0, cotaExtra })
}

const noCartao = () => { tabelas.licenca[0].stripeSubscriptionId = 'sub_1' }
const avisos = () => tabelas.avisoFiscal.map(a => a.tipo)

function cenario(ficha: Record<string, unknown> = {}) {
  const c = prepararCenario({ focusEmpresaToken: 'tp', ...ficha })
  const emitirOk = (ref: string, payload: unknown = nfe(), confirmar = false) => {
    c.focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
    return c.emissao.emitir(LICENCA, ref, payload, 'NFE', undefined, confirmar)
  }
  return { ...c, emitirOk }
}

describe('Fiscal — franquia de notas', () => {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T15:00:00Z') }))
  afterEach(() => mock.timers.reset())

  it('soma os três documentos: 40 NF-e + 30 NFC-e esgotam a franquia de quem paga por PIX', async () => {
    const { emissao, focus, franquia } = cenario()
    consumo('NFE', 40)
    consumo('NFCE', 30)

    const s = await franquia.situacao(LICENCA)
    assert.equal(s.emitidas, 70)
    assert.equal(s.formaCobranca, 'PIX')
    assert.equal(s.restantes, 0)

    await assert.rejects(emissao.emitir(LICENCA, 'v-71', nfe()), ehHttp(402, 'FRANQUIA_ESGOTADA'))
    assert.equal(focus.chamadas.length, 0, 'nada pode chegar à Focus')
  })

  it('cartão passa da franquia: emite, conta o excedente e avisa uma vez', async () => {
    const { franquia, emitirOk } = cenario()
    noCartao()
    consumo('NFE', 70)

    const r = await emitirOk('v-71')
    assert.equal(r.status, 'autorizado')
    await emitirOk('v-72', nfe({ items: [{ codigo_produto: 'P2', quantidade_comercial: 1, valor_unitario_comercial: 5 }] }))

    const s = await franquia.situacao(LICENCA)
    assert.equal(s.excedentes, 2)
    assert.equal(s.valorExcedente, 2)
    assert.deepEqual(avisos(), ['FRANQUIA_ATINGIDA'])
  })

  it('aviso de 80% sai na 56ª nota e não se repete', async () => {
    const { emitirOk } = cenario()
    noCartao()
    consumo('NFE', 55)
    await emitirOk('v-56')
    await emitirOk('v-57', nfe({ cnpj_destinatario: '99888777000166' }))
    assert.deepEqual(avisos(), ['FRANQUIA_80'])
  })

  it('cartão no teto de segurança: 402 TETO_MENSAL_ATINGIDO e aviso', async () => {
    const { emissao, focus } = cenario()
    noCartao()
    consumo('NFE', 200)
    consumo('NFSE', 100)
    await assert.rejects(emissao.emitir(LICENCA, 'v-301', nfe()), ehHttp(402, 'TETO_MENSAL_ATINGIDO'))
    assert.equal(focus.chamadas.length, 0)
    assert.deepEqual(avisos(), ['TETO_ATINGIDO'])
  })

  it('nota avulsa do admin soma na franquia e não é cobrada', async () => {
    const { franquia, emitirOk } = cenario()
    consumo('NFE', 72, 10)
    await emitirOk('v-73')
    const s = await franquia.situacao(LICENCA)
    assert.equal(s.franquia, 80)
    assert.equal(s.excedentes, 0)
  })

  it('excedente de mês anterior em aberto: o cartão trava na franquia como o PIX', async () => {
    const { emissao, franquia } = cenario()
    noCartao()
    tabelas.faturaExcedenteFiscal.push({ id: 'f-1', licencaId: LICENCA, competencia: '2026-10', status: 'FALHOU' })
    consumo('NFE', 70)
    assert.equal(await franquia.formaCobranca(LICENCA), 'PIX')
    await assert.rejects(emissao.emitir(LICENCA, 'v-71', nfe()), ehHttp(402, 'FRANQUIA_ESGOTADA'))
  })

  it('reenvio da ref que já saiu não leva 402: devolve a nota existente', async () => {
    const { emissao, focus, emitirOk } = cenario()
    consumo('NFE', 69)
    await emitirOk('v-70')
    focus.quando('consultar', AUTORIZADA)
    const r = await emissao.emitir(LICENCA, 'v-70', nfe())
    assert.equal(r.status, 'autorizado')
    assert.equal(focus.chamadasDe('emitir').length, 1, 'não emite de novo')
    await assert.rejects(emissao.emitir(LICENCA, 'v-71', nfe({ cnpj_destinatario: '99888777000166' })), ehHttp(402, 'FRANQUIA_ESGOTADA'))
  })

  it('homologação não passa pela franquia', async () => {
    const { emitirOk } = cenario({ ambiente: 2 })
    consumo('NFE', 500)
    const r = await emitirOk('v-teste')
    assert.equal(r.status, 'autorizado')
  })

  it('antes de novembro de 2026 a franquia não vale', async () => {
    mock.timers.setTime(new Date('2026-10-20T15:00:00Z').getTime())
    const { emitirOk } = cenario()
    consumo('NFE', 90, 0, LICENCA, '2026-10')
    const r = await emitirOk('v-91')
    assert.equal(r.status, 'autorizado')
  })
})

describe('Fiscal — nota repetida', () => {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T15:00:00Z') }))
  afterEach(() => mock.timers.reset())

  it('mesma NF-e com outra ref em menos de 1h: 409 e nada emitido; data e número não disfarçam', async () => {
    const { emissao, focus, emitirOk } = cenario()
    await emitirOk('venda-10', nfe({ data_emissao: '2026-11-10T12:00:00-03:00', numero: '10' }))

    await assert.rejects(
      emissao.emitir(LICENCA, 'venda-10-b', nfe({ data_emissao: '2026-11-10T12:05:00-03:00', numero: '11' })),
      ehHttp(409, 'NOTA_DUPLICADA_SUSPEITA'),
    )
    assert.equal(focus.chamadasDe('emitir').length, 1)
    assert.equal(tabelas.avisoFiscal.length, 1)
    assert.match(tabelas.avisoFiscal[0].tipo, /^DUPLICATA:2026-11-10$/)
  })

  it('operador confirmou (X-Confirmar-Duplicidade): emite', async () => {
    const { emitirOk } = cenario()
    await emitirOk('venda-10')
    const r = await emitirOk('venda-11', nfe(), true)
    assert.equal(r.status, 'autorizado')
  })

  it('a mesma ref de novo não é duplicata: segue para a idempotência da Focus', async () => {
    const { emissao, focus, emitirOk } = cenario()
    await emitirOk('venda-10')
    focus.quando('consultar', AUTORIZADA)
    const r = await emissao.emitir(LICENCA, 'venda-10', nfe())
    assert.equal(r.status, 'autorizado')
    assert.equal(focus.chamadasDe('emitir').length, 1)
  })

  it('passada 1h, a mesma nota volta a sair', async () => {
    const { emitirOk } = cenario()
    await emitirOk('venda-10')
    tabelas.emissaoLog[0].criadoEm = new Date(Date.now() - 61 * 60 * 1000)
    const r = await emitirOk('venda-11')
    assert.equal(r.status, 'autorizado')
  })

  it('NFC-e de balcão sem destinatário não é barrada; com CPF é', async () => {
    const { emissao, focus } = cenario()
    const cupom = (cpf?: string) => ({ cnpj_emitente: CNPJ, items: [{ codigo_produto: 'CAFE', quantidade: 1 }], ...(cpf ? { cpf_destinatario: cpf } : {}) })
    const emitirCupom = (ref: string, p: unknown) => {
      focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
      return emissao.emitir(LICENCA, ref, p, 'NFCE')
    }
    await emitirCupom('c-1', cupom())
    await emitirCupom('c-2', cupom())
    await emitirCupom('c-3', cupom('12345678909'))
    await assert.rejects(emissao.emitir(LICENCA, 'c-4', cupom('12345678909'), 'NFCE'), ehHttp(409, 'NOTA_DUPLICADA_SUSPEITA'))
  })

  it('assinatura ignora a ordem das chaves e muda com o conteúdo', () => {
    const a = assinaturaDaNota(LICENCA, 'NFE', { a: 1, b: { c: 2, d: 3 } })
    assert.equal(a, assinaturaDaNota(LICENCA, 'NFE', { b: { d: 3, c: 2 }, a: 1 }))
    assert.notEqual(a, assinaturaDaNota(LICENCA, 'NFE', { a: 2, b: { c: 2, d: 3 } }))
    assert.notEqual(a, assinaturaDaNota('outra', 'NFE', { a: 1, b: { c: 2, d: 3 } }))
  })
})

describe('Fiscal — fechamento do excedente', () => {
  class StripeFalso {
    chamadas: any[] = []
    resposta = { invoiceId: 'in_1', pago: true, erro: null as string | null }
    async cobrarAvulsoNaAssinatura(d: any) { this.chamadas.push(d); return this.resposta }
  }

  function preparar() {
    prepararCenario()
    tabelas.licenca[0].stripeSubscriptionId = 'sub_1'
    tabelas.licenca.push({ id: 'lic-pix', clienteId: 'cli-2', planoId: 'p' }, { id: 'lic-pouco', clienteId: 'cli-3', planoId: 'p', stripeSubscriptionId: 'sub_3' })
    consumo('NFE', 60, 5)
    consumo('NFCE', 35)
    consumo('NFE', 80, 0, 'lic-pix')
    consumo('NFE', 70, 0, 'lic-pouco')
    tabelas.consumoFiscal.push({ licencaId: 'lic-pouco', competencia: NOV, ambiente: 2, tipoDocumento: 'NFE', emitidas: 900, canceladas: 0, cotaExtra: 0 })
    const stripe = new StripeFalso()
    return { stripe, excedente: new FiscalExcedenteService(stripe as any) }
  }

  it('cobra só o que passou da franquia (com as avulsas), uma fatura por licença', async () => {
    const { stripe, excedente } = preparar()
    const r = await excedente.fecharMes(NOV)

    const cartao = r.find(x => x.licencaId === LICENCA)!
    assert.equal(cartao.emitidas, 95)
    assert.equal(cartao.franquia, 75)
    assert.equal(cartao.excedentes, 20)
    assert.equal(cartao.valor, 20)
    assert.equal(cartao.status, 'PAGA')
    assert.equal(stripe.chamadas.length, 1)
    assert.equal(stripe.chamadas[0].valor, 20)
    assert.equal(stripe.chamadas[0].chave, `excedente-${LICENCA}-${NOV}`)
    assert.deepEqual(stripe.chamadas[0].metadata, { tipo: 'EXCEDENTE_FISCAL', licencaId: LICENCA, competencia: NOV })

    assert.equal(r.find(x => x.licencaId === 'lic-pix')!.status, 'SEM_CARTAO')
    assert.equal(r.find(x => x.licencaId === 'lic-pouco'), undefined, '70 em produção não excede; homologação não conta')
  })

  it('rodar de novo não cobra duas vezes', async () => {
    const { stripe, excedente } = preparar()
    await excedente.fecharMes(NOV)
    await excedente.fecharMes(NOV)
    assert.equal(stripe.chamadas.length, 1)
    assert.equal(tabelas.faturaExcedenteFiscal.length, 2)
  })

  it('cartão recusado fica COBRANDO (o webhook marca FALHOU e avisa)', async () => {
    const { stripe, excedente } = preparar()
    stripe.resposta = { invoiceId: 'in_2', pago: false, erro: 'card_declined' }
    const r = await excedente.fecharMes(NOV)
    assert.equal(r.find(x => x.licencaId === LICENCA)!.status, 'COBRANDO')
    assert.equal(tabelas.faturaExcedenteFiscal.find(f => f.licencaId === LICENCA)!.stripeInvoiceId, 'in_2')
  })

  it('simular não grava nem cobra', async () => {
    const { stripe, excedente } = preparar()
    const r = await excedente.fecharMes(NOV, { simular: true })
    assert.equal(r.length, 2)
    assert.ok(r.every(x => x.status === 'SIMULADO'))
    assert.equal(stripe.chamadas.length, 0)
    assert.equal(tabelas.faturaExcedenteFiscal.length, 0)
  })

  it('outubro, antes da regra, não fecha nada', async () => {
    const { excedente } = preparar()
    consumo('NFE', 500, 0, LICENCA, '2026-10')
    assert.deepEqual(await excedente.fecharMes('2026-10'), [])
  })

  it('competência anterior vira o ano em janeiro', () => {
    assert.equal(competenciaAnterior('2027-01'), '2026-12')
    assert.equal(competenciaAnterior('2026-12'), '2026-11')
  })
})
