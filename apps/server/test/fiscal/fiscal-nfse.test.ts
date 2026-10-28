/**
 * NFS-e Nacional pela plataforma (docs/nfse-plano.md do ERP, F2): as mesmas
 * travas da NF-e, a tradução da resposta de `/nfsen` e a rota decidida na
 * ativação (MEI → Nacional; o resto espera a rota municipal).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tabelas } from '../apoio/prisma-falso'
import { prepararCenario, falhaHttp, ehHttp, LICENCA, CNPJ } from '../apoio/cenario-fiscal'
import { mapResultadoNfse } from '../../src/features/fiscal/fiscal-nfse.service'
import { rotaNfseDaAtivacao } from '../../src/features/fiscal/fiscal-onboarding.service'

const NAO_ENCONTRADA = falhaHttp(404, { codigo: 'nao_encontrado' })

const dps = (cnpj = CNPJ) => ({
  cnpj_prestador: cnpj,
  codigo_opcao_simples_nacional: '2',
  codigo_tributacao_nacional_iss: '010701',
  descricao_servico: 'Suporte técnico em informática',
  valor_servico: 150,
})

const AUTORIZADA = {
  status: 'autorizado',
  cnpj_prestador: CNPJ,
  ref: 'os-1-nfse',
  numero: '74798',
  codigo_verificacao: 'ABC123',
  data_emissao: '2026-10-28T11:25:14-03:00',
  url: 'https://www.nfse.gov.br/consultapublica?chave=1',
  url_danfse: '/arquivos/danfse.pdf',
  caminho_xml_nota_fiscal: '/arquivos/nfse.xml',
}

const REJEITADA = {
  status: 'erro_autorizacao',
  cnpj_prestador: CNPJ,
  ref: 'os-1-nfse',
  erros: [{ codigo: 'E0312', mensagem: 'Código de tributação nacional inexistente', correcao: 'Use a lista nacional' }],
}

describe('NFS-e — tradução da resposta da Focus', () => {
  it('autorizada: número, código de verificação e links absolutos do ambiente', () => {
    const r = mapResultadoNfse(AUTORIZADA, 2)
    assert.equal(r.status, 'autorizado')
    assert.equal(r.tipoDocumento, 'NFSE')
    assert.equal(r.numero, 74798)
    assert.equal(r.codigo_verificacao, 'ABC123')
    assert.equal(r.url_pdf, 'https://homologacao.focusnfe.com.br/arquivos/danfse.pdf')
    assert.equal(r.url_xml, 'https://homologacao.focusnfe.com.br/arquivos/nfse.xml')
    assert.equal(r.url_consulta, AUTORIZADA.url)
  })

  it('rejeitada: o motivo de erros[] vira mensagem, e o código alfanumérico fica em codigo_erro', () => {
    const r = mapResultadoNfse(REJEITADA, 1)
    assert.equal(r.status, 'erro')
    assert.equal(r.status_focus, 'erro_autorizacao')
    assert.equal(r.codigo_erro, 'E0312')
    assert.equal(r.codigo_sefaz, null)
    assert.equal(r.mensagem_sefaz, 'E0312 - Código de tributação nacional inexistente (Use a lista nacional)')
  })

  it('processando e cancelado', () => {
    assert.equal(mapResultadoNfse({ status: 'processando_autorizacao' }, 1).status, 'processando')
    assert.equal(mapResultadoNfse({ status: 'cancelado' }, 1).status, 'cancelado')
    assert.equal(mapResultadoNfse({ status: 'erro_cancelamento', erros: [{ codigo: 'V999' }] }, 1).status, 'erro')
  })
})

describe('NFS-e — emitir', () => {
  it('prestador com CNPJ diferente da ficha: 400 e nada enviado', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    await assert.rejects(nfse.emitir(LICENCA, 'os-1-nfse', dps('11222333000181')), ehHttp(400))
    assert.equal(focus.chamadas.length, 0)
  })

  it('emite pela rota NACIONAL com o corpo como veio, conta a cota e grava a trilha como NFSE', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp', ambiente: 1 })
    focus.quando('consultarNfsen', NAO_ENCONTRADA).quando('emitirNfsen', AUTORIZADA)

    const r = await nfse.emitir(LICENCA, 'os-1-nfse', dps())

    assert.equal(r.status, 'autorizado')
    const [token, ref, corpo, ambiente] = focus.chamadasDe('emitirNfsen')[0].args
    assert.deepEqual([token, ref, ambiente], ['tp', 'os-1-nfse', 1])
    assert.deepEqual(corpo, dps())                       // sem o tradutor da NF-e
    assert.equal(focus.chamadasDe('emitir').length, 0)   // nada pela rota da NF-e
    assert.equal(tabelas.consumoFiscal[0].tipoDocumento, 'NFSE')
    assert.equal(tabelas.consumoFiscal[0].emitidas, 1)
    assert.equal(tabelas.emissaoLog[0].tipoDocumento, 'NFSE')
  })

  it('ref já existente na Focus devolve a nota sem emitir de novo', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultarNfsen', AUTORIZADA)
    const r = await nfse.emitir(LICENCA, 'os-1-nfse', dps())
    assert.equal(r.numero, 74798)
    assert.equal(focus.chamadasDe('emitirNfsen').length, 0)
  })

  it('não saber se a ref existe (Focus 500) aborta com 503 e NÃO emite', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultarNfsen', falhaHttp(500))
    await assert.rejects(nfse.emitir(LICENCA, 'os-1-nfse', dps()), ehHttp(503))
    assert.equal(focus.chamadasDe('emitirNfsen').length, 0)
  })

  it('rejeitada não consome cota', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp', ambiente: 1 })
    focus.quando('consultarNfsen', NAO_ENCONTRADA).quando('emitirNfsen', REJEITADA)
    const r = await nfse.emitir(LICENCA, 'os-1-nfse', dps())
    assert.equal(r.status, 'erro')
    assert.equal(tabelas.consumoFiscal.length, 0)
  })
})

describe('NFS-e — consultar e cancelar', () => {
  it('404 da emissora vira NOTA_NAO_ENCONTRADA_NA_EMISSORA, como na NF-e', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultarNfsen', NAO_ENCONTRADA)
    await assert.rejects(nfse.consultar(LICENCA, 'os-1-nfse'), ehHttp(404, 'NOTA_NAO_ENCONTRADA_NA_EMISSORA'))
  })

  it('justificativa curta: 400 antes de falar com a Focus', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    await assert.rejects(nfse.cancelar(LICENCA, 'os-1-nfse', 'curta'), ehHttp(400))
    assert.equal(focus.chamadas.length, 0)
  })

  it('cancelada: conta em canceladas e grava CANCELAMENTO', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp', ambiente: 1 })
    focus.quando('cancelarNfsen', { status: 'cancelado' })
    const r = await nfse.cancelar(LICENCA, 'os-1-nfse', 'Serviço lançado em duplicidade')
    assert.equal(r.status, 'cancelado')
    assert.equal(focus.chamadasDe('cancelarNfsen')[0].args[2], 'Serviço lançado em duplicidade')
    assert.equal(tabelas.consumoFiscal[0].canceladas, 1)
    assert.equal(tabelas.emissaoLog[0].acao, 'CANCELAMENTO')
  })
})

describe('NFS-e — rota na ativação', () => {
  const EMITENTE = {
    cnpj: CNPJ,
    razao_social: '66.544.279 ALAN ALVES',
    codigo_regime_tributario: 4,
    endereco: { logradouro: 'R A', numero: '1', bairro: 'Centro', cidade: 'IGUATU', uf: 'CE', cep: '63500000' },
  }
  const dados = (emitente: Record<string, any> = EMITENTE) => ({
    emitente, email: 'loja@x.com', telefone: '88 0000-0000', arquivo_base64: 'MIIPFX', senha: 'senha',
  })
  const RESPOSTA = { id: 1, cnpj: CNPJ, token_producao: 'tp', token_homologacao: 'th' }

  beforeEach(() => { process.env.FOCUS_NFE_PARTNER_TOKEN = 'token-conta' })
  afterEach(() => { delete process.env.FOCUS_NFE_PARTNER_TOKEN })

  it('regra: sem NFSE nada; MEI Nacional; os demais esperam a municipal', () => {
    assert.equal(rotaNfseDaAtivacao(['NFE'], EMITENTE), null)
    assert.equal(rotaNfseDaAtivacao(undefined, EMITENTE), null)
    assert.equal(rotaNfseDaAtivacao(['NFSE'], EMITENTE), 'NACIONAL')
    assert.equal(rotaNfseDaAtivacao(['NFSE'], { ...EMITENTE, codigo_regime_tributario: 1 }), 'MUNICIPAL_PENDENTE')
  })

  it('MEI só com NFSE: a ficha nasce e a Focus recebe a Nacional ligada (e nunca a municipal)', async () => {
    const { onboarding, focus } = prepararCenario(null)
    focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA)

    const r = await onboarding.ativarEmissao(LICENCA, ['NFSE'], dados())

    assert.equal(r.nfse, 'NACIONAL')
    const [, corpo] = focus.chamadasDe('criarEmpresa')[0].args
    assert.equal(corpo.habilita_nfsen_producao, true)
    assert.equal(corpo.habilita_nfsen_homologacao, true)
    assert.equal('habilita_nfse' in corpo, false)
  })

  it('Simples (não MEI) com NFSE: nada de NFS-e ligado na Focus, e a resposta avisa', async () => {
    const { onboarding, focus } = prepararCenario({})
    focus.quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)

    const r = await onboarding.ativarEmissao(LICENCA, ['NFE', 'NFSE'], dados({ ...EMITENTE, codigo_regime_tributario: 1 }))

    assert.equal(r.nfse, 'MUNICIPAL_PENDENTE')
    const [, , corpo] = focus.chamadasDe('atualizarEmpresa')[0].args
    assert.equal('habilita_nfsen_producao' in corpo, false)
    assert.equal('habilita_nfse' in corpo, false)
  })

  it('sem NFSE na licença: o corpo da ativação é o de antes', async () => {
    const { onboarding, focus } = prepararCenario({})
    focus.quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)

    const r = await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())

    assert.equal(r.nfse, null)
    const [, , corpo] = focus.chamadasDe('atualizarEmpresa')[0].args
    assert.equal(Object.keys(corpo).some(k => k.startsWith('habilita_nfse')), false)
  })
})
