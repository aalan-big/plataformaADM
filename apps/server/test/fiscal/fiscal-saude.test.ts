/**
 * Painel de saúde fiscal (F4) e o desfecho da consulta na `EmissaoLog`, que é
 * de onde o painel tira a última nota e as rejeições.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { FiscalSaudeService } from '../../src/features/fiscal/fiscal-saude.service'
import { prepararCenario, falhaHttp, CLIENTE, LICENCA, PLANO, CNPJ } from '../apoio/cenario-fiscal'
import { tabelas } from '../apoio/prisma-falso'

const AGORA = new Date('2026-10-07T15:00:00Z')
const dias = (n: number) => new Date(AGORA.getTime() + n * 24 * 60 * 60 * 1000)

const EMPRESA_OK = {
  id: 77, cnpj: CNPJ,
  certificado_valido_ate: dias(200).toISOString(), certificado_cnpj: CNPJ,
  habilita_nfe: true, habilita_nfce: true,
  token_producao: 'SEGREDO-TP', token_homologacao: 'SEGREDO-TH', csc_nfce_producao: 'SEGREDO-CSC',
}

const FICHA_OK = { focusEmpresaId: '77', focusEmpresaToken: 'tk', certificadoStatus: 'ATIVO' }

function montar(ficha: Record<string, any> | null = FICHA_OK) {
  const cenario = prepararCenario(ficha)
  const saude = new FiscalSaudeService(cenario.focus as any)
  const item = async (chave: string) => (await saude.saudeDoCliente(CLIENTE, AGORA)).itens.find(i => i.chave === chave)
  return { ...cenario, saude, item }
}

const nfceNoPlano = () => tabelas.planoModulo.push({ planoId: PLANO, identificador: 'NFCE' })

describe('FiscalSaudeService — painel de saúde fiscal', () => {
  beforeEach(() => { process.env.FOCUS_NFE_PARTNER_TOKEN = 'token-conta' })
  afterEach(() => {
    delete process.env.FOCUS_NFE_PARTNER_TOKEN
    delete process.env.FOCUS_CONTA_TOKEN
  })

  it('sem ficha: um item vermelho e nenhuma chamada à Focus', async () => {
    const { saude, focus } = montar(null)
    const r = await saude.saudeDoCliente(CLIENTE, AGORA)
    assert.equal(r.geral, 'problema')
    assert.equal(r.ficha, null)
    assert.deepEqual(r.itens.map(i => i.chave), ['ficha'])
    assert.equal(focus.chamadas.length, 0)
  })

  it('tudo certo: verde, só LEITURA na Focus e nenhum segredo na resposta', async () => {
    const { saude, focus } = montar()
    focus.quando('consultarEmpresa', EMPRESA_OK)
    tabelas.emissaoLog.push({ licencaId: LICENCA, ref: 'v1', acao: 'EMISSAO', resultado: 'autorizado', ambiente: 1, tipoDocumento: 'NFE', criadoEm: dias(-1), codigoSefaz: 100 })

    const r = await saude.saudeDoCliente(CLIENTE, AGORA)

    assert.equal(r.geral, 'ok', JSON.stringify(r.itens))
    assert.equal(r.focusConsultada, true)
    assert.deepEqual(focus.chamadas.map(c => c.metodo), ['consultarEmpresa'])
    assert.deepEqual(focus.chamadasDe('consultarEmpresa')[0].args, ['token-conta', '77'])
    const json = JSON.stringify(r)
    assert.ok(!json.includes('SEGREDO'), 'token ou CSC da Focus vazou na resposta')
    assert.ok(!json.includes('"tk"'), 'token da ficha vazou na resposta')
  })

  it('sem token de parceiro: Focus "desconhecido", certificado pelo dado local, sem chamar a Focus', async () => {
    delete process.env.FOCUS_NFE_PARTNER_TOKEN
    const { item, focus } = montar({ ...FICHA_OK, certificadoVencimento: dias(100) })
    assert.equal((await item('empresa'))!.estado, 'desconhecido')
    const cert = (await item('certificado'))!
    assert.equal(cert.estado, 'ok')
    assert.match(cert.detalhe, /dado local/)
    assert.equal((await item('habilitacao'))!.estado, 'desconhecido')
    assert.equal(focus.chamadas.length, 0)
  })

  it('Focus fora do ar não derruba o painel', async () => {
    const { saude, focus } = montar()
    focus.quando('consultarEmpresa', falhaHttp(503))
    const r = await saude.saudeDoCliente(CLIENTE, AGORA)
    assert.equal(r.focusConsultada, false)
    assert.equal(r.itens.find(i => i.chave === 'empresa')!.estado, 'desconhecido')
  })

  it('id da ficha inexistente na Focus (404): vermelho', async () => {
    const { item, focus } = montar()
    focus.quando('consultarEmpresa', falhaHttp(404))
    const empresa = (await item('empresa'))!
    assert.equal(empresa.estado, 'problema')
    assert.match(empresa.detalhe, /não existe na Focus/)
  })

  it('id da ficha aponta para OUTRO CNPJ na Focus: vermelho', async () => {
    const { item, focus } = montar()
    focus.quando('consultarEmpresa', { ...EMPRESA_OK, cnpj: '11222333000181' })
    const empresa = (await item('empresa'))!
    assert.equal(empresa.estado, 'problema')
    assert.match(empresa.detalhe, /OUTRO CNPJ/)
  })

  it('sem id na ficha: acha pelo CNPJ e avisa (atenção), sem gravar nada', async () => {
    const { item, focus, ficha } = montar({ ...FICHA_OK, focusEmpresaId: null })
    focus.quando('buscarEmpresaPorCnpj', { id: 77, cnpj: CNPJ }).quando('consultarEmpresa', EMPRESA_OK)
    assert.equal((await item('empresa'))!.estado, 'atencao')
    assert.equal(ficha().focusEmpresaId, null)
    assert.equal(focus.chamadasDe('atualizarEmpresa').length, 0)
  })

  it('empresa inexistente na Focus: vermelho', async () => {
    const { item, focus } = montar({ ...FICHA_OK, focusEmpresaId: null })
    focus.quando('buscarEmpresaPorCnpj', null)
    assert.equal((await item('empresa'))!.estado, 'problema')
  })

  it('certificado: vencido vermelho, < 30 dias amarelo, de outro CNPJ vermelho', async () => {
    let c = montar()
    c.focus.quando('consultarEmpresa', { ...EMPRESA_OK, certificado_valido_ate: dias(-2).toISOString() })
    assert.equal((await c.item('certificado'))!.estado, 'problema')

    c = montar()
    c.focus.quando('consultarEmpresa', { ...EMPRESA_OK, certificado_valido_ate: dias(10).toISOString() })
    assert.equal((await c.item('certificado'))!.estado, 'atencao')

    c = montar()
    c.focus.quando('consultarEmpresa', { ...EMPRESA_OK, certificado_cnpj: '11222333000181' })
    assert.equal((await c.item('certificado'))!.estado, 'problema')

    c = montar()
    c.focus.quando('consultarEmpresa', { ...EMPRESA_OK, certificado_valido_ate: null })
    assert.equal((await c.item('certificado'))!.estado, 'problema')
  })

  it('certificado da matriz numa filial (mesma raiz) não acusa', async () => {
    const { item, focus } = montar()
    focus.quando('consultarEmpresa', { ...EMPRESA_OK, certificado_cnpj: CNPJ.slice(0, 8) + '000299' })
    assert.equal((await item('certificado'))!.estado, 'ok')
  })

  it('NF-e desabilitada: vermelho; NFC-e desabilitada só importa com o módulo NFCE', async () => {
    let c = montar()
    c.focus.quando('consultarEmpresa', { ...EMPRESA_OK, habilita_nfe: false })
    assert.equal((await c.item('habilitacao'))!.estado, 'problema')

    c = montar()
    c.focus.quando('consultarEmpresa', { ...EMPRESA_OK, habilita_nfce: false })
    assert.equal((await c.item('habilitacao'))!.estado, 'ok')
    assert.equal(await c.item('csc'), undefined, 'CSC não entra sem NFC-e')

    c = montar()
    nfceNoPlano()
    c.focus.quando('consultarEmpresa', { ...EMPRESA_OK, habilita_nfce: false })
    assert.equal((await c.item('habilitacao'))!.estado, 'problema')
  })

  it('CSC: pela Focus quando ela informa, pelo marcador da ficha quando não', async () => {
    let c = montar()
    nfceNoPlano()
    c.focus.quando('consultarEmpresa', { ...EMPRESA_OK, csc_nfce_producao: null })
    assert.equal((await c.item('csc'))!.estado, 'problema')

    c = montar({ ...FICHA_OK, cscConfigurado: true })
    nfceNoPlano()
    const { csc_nfce_producao: _, ...semCsc } = EMPRESA_OK
    c.focus.quando('consultarEmpresa', semCsc)
    const csc = (await c.item('csc'))!
    assert.equal(csc.estado, 'ok')
    assert.match(csc.detalhe, /marcador da ficha/)
  })

  it('token: cifrado ilegível (sem FISCAL_TOKENS_KEY) é vermelho e diz o motivo', async () => {
    const { item, focus } = montar({ ...FICHA_OK, focusEmpresaToken: null, focusTokenProducao: 'v1:a:b:c' })
    focus.quando('consultarEmpresa', EMPRESA_OK)
    const token = (await item('token'))!
    assert.equal(token.estado, 'problema')
    assert.match(token.detalhe, /FISCAL_TOKENS_KEY/)
  })

  it('token: nenhum é vermelho', async () => {
    const { item, focus } = montar({ ...FICHA_OK, focusEmpresaToken: null })
    focus.quando('consultarEmpresa', EMPRESA_OK)
    assert.equal((await item('token'))!.estado, 'problema')
  })

  it('homologação é atenção', async () => {
    const { item, focus } = montar({ ...FICHA_OK, ambiente: 2 })
    focus.quando('consultarEmpresa', EMPRESA_OK)
    assert.equal((await item('ambiente'))!.estado, 'atencao')
  })

  it('sem nota autorizada é atenção', async () => {
    const { item, focus } = montar()
    focus.quando('consultarEmpresa', EMPRESA_OK)
    assert.equal((await item('ultima_nota'))!.estado, 'atencao')
  })

  it('rejeições dos últimos 7 dias agrupadas pelo cStat; fora da janela e "processando" não contam', async () => {
    const { saude, focus } = montar()
    focus.quando('consultarEmpresa', EMPRESA_OK)
    const log = (resultado: string, codigoSefaz: number | null, mensagem: string, criadoEm: Date) =>
      tabelas.emissaoLog.push({ licencaId: LICENCA, ref: 'x', acao: 'EMISSAO', resultado, ambiente: 1, tipoDocumento: 'NFE', codigoSefaz, mensagem, criadoEm })
    log('erro', 481, 'Rejeição: Código Regime Tributário do emitente diverge', dias(-1))
    log('erro', 481, 'Rejeição: Código Regime Tributário do emitente diverge', dias(-2))
    log('erro', 539, 'Rejeição: Duplicidade de NF-e', dias(-3))
    log('erro', 305, 'Rejeição: Destinatário bloqueado na UF', dias(-9))
    log('processando', null, null as any, dias(-1))

    const r = await saude.saudeDoCliente(CLIENTE, AGORA)

    assert.deepEqual(r.rejeicoes.map(g => [g.codigoSefaz, g.quantidade]), [[481, 2], [539, 1]])
    assert.equal(r.itens.find(i => i.chave === 'rejeicoes')!.estado, 'atencao')
  })
})

describe('Fiscal — a consulta grava o desfecho na EmissaoLog', () => {
  it('autorizada na consulta vira linha EMISSAO/autorizado com o cStat, uma vez só', async () => {
    const { emissao, focus } = prepararCenario({ focusEmpresaToken: 'tk' })
    const AUTORIZADA = { status: 'autorizado', status_sefaz: '100', mensagem_sefaz: 'Autorizado o uso da NF-e' }
    focus.quando('consultar', AUTORIZADA, AUTORIZADA)

    await emissao.consultar(LICENCA, 'venda-1')
    await emissao.consultar(LICENCA, 'venda-1')

    assert.equal(tabelas.emissaoLog.length, 1)
    assert.equal(tabelas.emissaoLog[0].acao, 'EMISSAO')
    assert.equal(tabelas.emissaoLog[0].resultado, 'autorizado')
    assert.equal(tabelas.emissaoLog[0].codigoSefaz, 100)
  })

  it('rejeição na consulta vira linha EMISSAO/erro com o cStat', async () => {
    const { emissao, focus } = prepararCenario({ focusEmpresaToken: 'tk' })
    focus.quando('consultar', { status: 'erro_autorizacao', status_sefaz: '481', mensagem_sefaz: 'Rejeição: CRT diverge' })
    await emissao.consultar(LICENCA, 'venda-2')
    assert.equal(tabelas.emissaoLog.length, 1)
    assert.equal(tabelas.emissaoLog[0].resultado, 'erro')
    assert.equal(tabelas.emissaoLog[0].codigoSefaz, 481)
  })

  it('processando e cancelado não gravam', async () => {
    const { emissao, focus } = prepararCenario({ focusEmpresaToken: 'tk' })
    focus.quando('consultar', { status: 'processando_autorizacao' }, { status: 'cancelado' })
    await emissao.consultar(LICENCA, 'venda-3')
    await emissao.consultar(LICENCA, 'venda-3')
    assert.equal(tabelas.emissaoLog.length, 0)
  })
})
