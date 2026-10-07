/**
 * Cadastro do emitente na Focus: certificado, CSC e o `/config` que o ERP lê.
 *
 * Estes testes fotografam o comportamento de HOJE (F0 do plano
 * `docs/fiscal-refatoracao-plano.md` no ERP). Quando a F2 mudar alguma regra, o
 * teste muda junto, no mesmo commit — é assim que a mudança fica visível.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { prepararCenario, falhaHttp, ehHttp, LICENCA, CNPJ } from '../apoio/cenario-fiscal'

const PFX = 'MIIFAKE'
const SENHA = 'senha'

describe('Fiscal — certificado', () => {
  beforeEach(() => { process.env.FOCUS_NFE_PARTNER_TOKEN = 'token-conta' })
  afterEach(() => {
    delete process.env.FOCUS_NFE_PARTNER_TOKEN
    delete process.env.FOCUS_CONTA_TOKEN
  })

  it('sem ficha fiscal: 404 SEM_CONFIGURACAO_FISCAL, sem falar com a Focus (o caso do Celso)', async () => {
    const { onboarding, focus } = prepararCenario(null)
    await assert.rejects(onboarding.enviarCertificado(LICENCA, PFX, SENHA), ehHttp(404, 'SEM_CONFIGURACAO_FISCAL'))
    assert.equal(focus.chamadas.length, 0)
  })

  it('licença inexistente: 404 LICENCA_NAO_ENCONTRADA', async () => {
    const { onboarding } = prepararCenario()
    await assert.rejects(onboarding.enviarCertificado('outra', PFX, SENHA), ehHttp(404, 'LICENCA_NAO_ENCONTRADA'))
  })

  it('sem token de parceiro no .env: 501 PLATAFORMA_SEM_TOKEN_DA_CONTA', async () => {
    delete process.env.FOCUS_NFE_PARTNER_TOKEN
    const { onboarding, focus } = prepararCenario()
    await assert.rejects(onboarding.enviarCertificado(LICENCA, PFX, SENHA), ehHttp(501, 'PLATAFORMA_SEM_TOKEN_DA_CONTA'))
    assert.equal(focus.chamadas.length, 0)
  })

  it('aceita o nome antigo FOCUS_CONTA_TOKEN', async () => {
    delete process.env.FOCUS_NFE_PARTNER_TOKEN
    process.env.FOCUS_CONTA_TOKEN = 'token-antigo'
    const { onboarding, focus } = prepararCenario({ focusEmpresaId: '10' })
    focus.quando('atualizarEmpresa', { token_producao: 'tp' })
    await onboarding.enviarCertificado(LICENCA, PFX, SENHA)
    assert.equal(focus.chamadasDe('atualizarEmpresa')[0].args[0], 'token-antigo')
  })

  it('empresa ainda não cadastrada na Focus: 501 EMPRESA_SEM_CADASTRO_NA_EMISSORA e nada gravado', async () => {
    const { onboarding, focus, ficha } = prepararCenario()
    focus.quando('buscarEmpresaPorCnpj', null)
    await assert.rejects(onboarding.enviarCertificado(LICENCA, PFX, SENHA), ehHttp(501, 'EMPRESA_SEM_CADASTRO_NA_EMISSORA'))
    assert.equal(focus.chamadasDe('atualizarEmpresa').length, 0)
    assert.equal(ficha().focusEmpresaId, null)
    assert.equal(ficha().certificadoStatus, 'AUSENTE')
  })

  it('descobre o id pelo CNPJ, grava-o, envia o certificado e guarda o token de PRODUÇÃO', async () => {
    const { onboarding, focus, ficha } = prepararCenario({ ambiente: 1 })
    focus
      .quando('buscarEmpresaPorCnpj', { id: 77, cnpj: CNPJ })
      .quando('atualizarEmpresa', { token_producao: 'tp', token_homologacao: 'th', certificado_valido_ate: '2027-05-01T00:00:00Z' })

    const r = await onboarding.enviarCertificado(LICENCA, PFX, SENHA)

    assert.equal(focus.chamadasDe('buscarEmpresaPorCnpj')[0].args[1], CNPJ)
    const [tokenConta, empresaId, dados] = focus.chamadasDe('atualizarEmpresa')[0].args
    assert.equal(tokenConta, 'token-conta')
    assert.equal(empresaId, '77')
    assert.equal(dados.arquivo_certificado_base64, PFX)
    assert.equal(dados.senha_certificado, SENHA)
    assert.equal(dados.habilita_nfe, true)
    assert.equal(dados.habilita_nfce, true)

    assert.equal(ficha().focusEmpresaId, '77')
    assert.equal(ficha().focusEmpresaToken, 'tp')
    assert.equal(ficha().certificadoStatus, 'ATIVO')
    assert.equal(ficha().certificadoVencimento.toISOString(), '2027-05-01T00:00:00.000Z')
    assert.equal(r.status, 'ATIVO')
    assert.equal(r.valido_ate, '2027-05-01T00:00:00.000Z')
    // Nenhum segredo volta ao ERP.
    assert.equal(JSON.stringify(r).includes('tp'), false)
  })

  it('ficha em homologação guarda o token de HOMOLOGAÇÃO', async () => {
    const { onboarding, focus, ficha } = prepararCenario({ ambiente: 2, focusEmpresaId: '77' })
    focus.quando('atualizarEmpresa', { token_producao: 'tp', token_homologacao: 'th' })
    await onboarding.enviarCertificado(LICENCA, PFX, SENHA)
    assert.equal(ficha().focusEmpresaToken, 'th')
    assert.equal(focus.chamadasDe('buscarEmpresaPorCnpj').length, 0)
  })

  it('token vazio na resposta não apaga o token colado à mão', async () => {
    const { onboarding, focus, ficha } = prepararCenario({ focusEmpresaId: '77', focusEmpresaToken: 'colado' })
    focus.quando('atualizarEmpresa', {})
    await onboarding.enviarCertificado(LICENCA, PFX, SENHA)
    assert.equal(ficha().focusEmpresaToken, 'colado')
  })

  it('o id descoberto fica gravado mesmo se o envio do certificado falhar', async () => {
    const { onboarding, focus, ficha } = prepararCenario()
    focus
      .quando('buscarEmpresaPorCnpj', { id: 77, cnpj: CNPJ })
      .quando('atualizarEmpresa', falhaHttp(422, { mensagem: 'senha do certificado inválida' }))
    await assert.rejects(onboarding.enviarCertificado(LICENCA, PFX, SENHA), ehHttp(422))
    assert.equal(ficha().focusEmpresaId, '77')
    assert.equal(ficha().certificadoStatus, 'AUSENTE')
  })

  it('401 da Focus no envio é o NOSSO token: vira 501, nunca "certificado recusado"', async () => {
    const { onboarding, focus } = prepararCenario({ focusEmpresaId: '77' })
    focus.quando('atualizarEmpresa', falhaHttp(401))
    await assert.rejects(onboarding.enviarCertificado(LICENCA, PFX, SENHA), ehHttp(501, 'PLATAFORMA_SEM_TOKEN_DA_CONTA'))
  })

  it('401 na busca pelo CNPJ também vira 501', async () => {
    const { onboarding, focus } = prepararCenario()
    focus.quando('buscarEmpresaPorCnpj', falhaHttp(403))
    await assert.rejects(onboarding.enviarCertificado(LICENCA, PFX, SENHA), ehHttp(501, 'PLATAFORMA_SEM_TOKEN_DA_CONTA'))
  })
})

describe('Fiscal — CSC', () => {
  beforeEach(() => { process.env.FOCUS_NFE_PARTNER_TOKEN = 'token-conta' })
  afterEach(() => { delete process.env.FOCUS_NFE_PARTNER_TOKEN })

  it('produção grava os campos de produção e marca cscConfigurado', async () => {
    const { onboarding, focus, ficha } = prepararCenario({ ambiente: 1, focusEmpresaId: '77' })
    focus.quando('atualizarEmpresa', {})
    const r = await onboarding.cadastrarCsc(LICENCA, '000001', 'ABC')
    assert.deepEqual(focus.chamadasDe('atualizarEmpresa')[0].args[2], { id_token_nfce_producao: 1, csc_nfce_producao: 'ABC' })
    assert.equal(ficha().cscConfigurado, true)
    assert.equal(JSON.stringify(r).includes('ABC'), false)
  })

  it('homologação grava os campos de homologação', async () => {
    const { onboarding, focus } = prepararCenario({ ambiente: 2, focusEmpresaId: '77' })
    focus.quando('atualizarEmpresa', {})
    await onboarding.cadastrarCsc(LICENCA, '2', 'XYZ')
    assert.deepEqual(focus.chamadasDe('atualizarEmpresa')[0].args[2], { id_token_nfce_homologacao: 2, csc_nfce_homologacao: 'XYZ' })
  })
})

describe('Fiscal — configFiscal', () => {
  it('sem ficha: configurado false, sem erro', async () => {
    const { onboarding } = prepararCenario(null)
    const r = await onboarding.configFiscal(LICENCA)
    assert.equal(r.configurado, false)
    assert.equal(r.ambiente, null)
  })

  it('lista as pendências e nunca devolve o token', async () => {
    const { onboarding } = prepararCenario({ focusEmpresaToken: null, certificadoStatus: 'AUSENTE' })
    const r = await onboarding.configFiscal(LICENCA)
    assert.equal(r.configurado, true)
    assert.equal(r.tokenConfigurado, false)
    assert.ok(r.pendencias.some(p => p.includes('Token')))
    assert.ok(r.pendencias.some(p => p.includes('Certificado digital não informado')))
    assert.equal('focusEmpresaToken' in r, false)
  })

  it('ficha completa em produção: só a pendência de CSC quando falta', async () => {
    const { onboarding } = prepararCenario({ focusEmpresaToken: 'tp', certificadoStatus: 'ATIVO', cscConfigurado: false })
    const r = await onboarding.configFiscal(LICENCA)
    assert.equal(r.ambienteNome, 'Producao')
    assert.equal(r.pendencias.length, 1)
    assert.match(r.pendencias[0], /CSC/)
  })
})
