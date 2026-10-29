/**
 * NFS-e pela rota MUNICIPAL (G6 da NFS-e no ERP): a tradução DPS → `/v2/nfse`,
 * a escolha da rota pela cidade na ativação, a emissão pela rota da ficha e o
 * cache das cidades.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Logger } from '@nestjs/common'
import { tabelas } from '../apoio/prisma-falso'
import { prepararCenario, falhaHttp, ehHttp, LICENCA, CLIENTE, CNPJ } from '../apoio/cenario-fiscal'
import { instalarFetchFalso } from '../apoio/fetch-falso'
import { dpsParaNfseMunicipal, semExtensaoMunicipal } from '../../src/common/focus-nfe/focus-nfse-municipal.mapper'
import { FocusNfeService } from '../../src/common/focus-nfe/focus-nfe.service'
import { rotaNfseDaAtivacao } from '../../src/features/fiscal/fiscal-onboarding.service'
import { cacheDaFocus, codigoIbgeDoEmitente } from '../../src/features/fiscal/fiscal-municipio.service'

const IGUATU = '2305506'
const ICO = '2305407'

/** DPS como o ERP monta (payload.py), Simples Nacional, tomador PJ com endereço. */
const DPS = {
  data_emissao: '2026-10-29T10:00:00-03:00',
  data_competencia: '2026-10-29',
  emitente_dps: '1',
  codigo_municipio_emissora: 2305506,
  cnpj_prestador: CNPJ,
  inscricao_municipal_prestador: '12345',
  codigo_opcao_simples_nacional: '3',
  regime_especial_tributacao: '0',
  codigo_municipio_prestacao: IGUATU,
  codigo_tributacao_nacional_iss: '140101',
  codigo_tributacao_municipal_iss: '1401',
  codigo_nbs: '120012200',
  descricao_servico: 'Manutenção de notebook',
  valor_servico: 250,
  desconto_incondicionado: 10,
  tributacao_iss: '1',
  tipo_retencao_iss: '1',
  percentual_aliquota_relativa_municipio: 5,
  cnpj_tomador: '11222333000181',
  razao_social_tomador: 'Cliente Ltda',
  email_tomador: 'c@x.com',
  telefone_tomador: '88999990000',
  logradouro_tomador: 'Rua A',
  numero_tomador: '10',
  bairro_tomador: 'Centro',
  cep_tomador: '63500000',
  codigo_municipio_tomador: IGUATU,
}

describe('DPS → NFS-e municipal (fotografia)', () => {
  it('traduz para prestador/tomador/servico no formato de /v2/nfse', () => {
    assert.deepEqual(dpsParaNfseMunicipal(DPS), {
      data_emissao: '2026-10-29T10:00:00-03:00',
      natureza_operacao: '1',
      regime_especial_tributacao: '6',
      optante_simples_nacional: true,
      prestador: { cnpj: CNPJ, inscricao_municipal: '12345', codigo_municipio: IGUATU },
      tomador: {
        cnpj: '11222333000181',
        razao_social: 'Cliente Ltda',
        email: 'c@x.com',
        telefone: '88999990000',
        endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', codigo_municipio: IGUATU, cep: '63500000' },
      },
      servico: {
        valor_servicos: 250,
        desconto_incondicionado: 10,
        iss_retido: false,
        item_lista_servico: '1401',
        codigo_tributario_municipio: '1401',
        discriminacao: 'Manutenção de notebook',
        codigo_municipio: IGUATU,
        aliquota: 0.05,
        codigo_nbs: '120012200',
      },
    })
  })

  it('serviço em outra cidade (obra da marcenaria) é natureza 2; retenção vira iss_retido', () => {
    const r = dpsParaNfseMunicipal({ ...DPS, codigo_municipio_prestacao: ICO, tipo_retencao_iss: '2' })
    assert.equal(r.natureza_operacao, '2')
    assert.equal(r.servico.codigo_municipio, ICO)
    assert.equal(r.servico.iss_retido, true)
  })

  it('MEI vira regime 5 e não optante (regime normal) não leva regime especial', () => {
    assert.equal(dpsParaNfseMunicipal({ ...DPS, codigo_opcao_simples_nacional: '2' }).regime_especial_tributacao, '5')
    const normal = dpsParaNfseMunicipal({ ...DPS, codigo_opcao_simples_nacional: '1' })
    assert.equal(normal.optante_simples_nacional, false)
    assert.equal('regime_especial_tributacao' in normal, false)
    // Regime especial do cadastro (nacional 1 = cooperativa → ABRASF 4).
    assert.equal(dpsParaNfseMunicipal({ ...DPS, regime_especial_tributacao: '1' }).regime_especial_tributacao, '4')
  })

  it('extensão _municipal: CNAE e item da lista do ERP vencem, e nunca seguem crus', () => {
    const r = dpsParaNfseMunicipal({ ...DPS, _municipal: { codigo_cnae: '9511-8/00', item_lista_servico: '14.01' } })
    assert.equal(r.servico.codigo_cnae, '9511800')
    assert.equal(r.servico.item_lista_servico, '14.01')
    assert.equal('_municipal' in r, false)
  })

  it('tomador pessoa física sem endereço: só CPF e nome, sem objeto vazio', () => {
    const r = dpsParaNfseMunicipal({
      ...DPS, cnpj_tomador: undefined, cpf_tomador: '12345678909',
      logradouro_tomador: undefined, numero_tomador: undefined, bairro_tomador: undefined,
      cep_tomador: undefined, codigo_municipio_tomador: undefined, telefone_tomador: undefined, email_tomador: undefined,
    })
    assert.deepEqual(r.tomador, { cpf: '12345678909', razao_social: 'Cliente Ltda' })
  })

  it('a Nacional recebe a DPS sem a extensão', () => {
    assert.deepEqual(semExtensaoMunicipal({ a: 1, _municipal: { codigo_cnae: '1' } }), { a: 1 })
    const semNada = { a: 1 }
    assert.equal(semExtensaoMunicipal(semNada), semNada)
  })
})

describe('FocusNfeService — rota municipal na rede', () => {
  let rede: ReturnType<typeof instalarFetchFalso>
  beforeEach(() => { rede = instalarFetchFalso() })
  afterEach(() => rede.restaurar())

  it('emite em /v2/nfse com o corpo traduzido; cancela com DELETE /nfse/{ref}', async () => {
    const focus = new FocusNfeService()
    rede.responder(201, { status: 'processando_autorizacao' })
    rede.responder(200, { status: 'cancelado' })
    await focus.emitirNfseMunicipal('tok', 'os-1-nfse', DPS, 2)
    await focus.cancelarNfseMunicipal('tok', 'os-1-nfse', 'Serviço lançado em duplicidade', 2)
    assert.equal(rede.chamadas[0].url, 'https://homologacao.focusnfe.com.br/v2/nfse?ref=os-1-nfse')
    assert.equal(rede.chamadas[0].body.prestador.cnpj, CNPJ)
    assert.equal('cnpj_prestador' in rede.chamadas[0].body, false)
    assert.equal(rede.chamadas[1].method, 'DELETE')
    assert.equal(rede.chamadas[1].url, 'https://homologacao.focusnfe.com.br/v2/nfse/os-1-nfse')
  })

  it('a Nacional não leva o _municipal', async () => {
    const focus = new FocusNfeService()
    rede.responder(201, { status: 'processando_autorizacao' })
    await focus.emitirNfsen('tok', 'r', { ...DPS, _municipal: { codigo_cnae: '1' } }, 2)
    assert.equal('_municipal' in rede.chamadas[0].body, false)
    assert.equal(rede.chamadas[0].body.cnpj_prestador, CNPJ)
  })

  it('município: 404 vira null; busca por nome confere sem acento e com UF', async () => {
    const focus = new FocusNfeService()
    rede.responder(404, { codigo: 'nao_encontrado' })
    assert.equal(await focus.consultarMunicipio('conta', '9999999'), null)
    rede.responder(200, [
      { codigo_municipio: '4110052', nome_municipio: 'Iguatu', sigla_uf: 'PR' },
      { codigo_municipio: IGUATU, nome_municipio: 'Iguatu', sigla_uf: 'CE' },
    ])
    const achado = await focus.buscarMunicipioPorNome('conta', 'IGUATU', 'ce')
    assert.equal(achado.codigo_municipio, IGUATU)
    assert.match(rede.chamadas[1].url, /municipios\?sigla_uf=CE&nome_municipio=IGUATU$/)
  })
})

describe('Rota na ativação, pela cidade', () => {
  const EMITENTE = {
    cnpj: CNPJ,
    razao_social: 'Loja Simples',
    codigo_regime_tributario: 1,
    endereco: { logradouro: 'R A', numero: '1', bairro: 'Centro', cidade: 'Iguatu', uf: 'CE', cep: '63500000', codigo_municipio: IGUATU },
  }
  const dados = (extra: Record<string, any> = {}) => ({
    emitente: EMITENTE, email: 'loja@x.com', telefone: null, arquivo_base64: 'MIIPFX', senha: 'senha-cert', ...extra,
  })
  const RESPOSTA = { id: 1, cnpj: CNPJ, token_producao: 'tp', token_homologacao: 'th' }
  const FOCUS_IGUATU = { codigo_municipio: IGUATU, nome_municipio: 'Iguatu', sigla_uf: 'CE', status_nfse: 'ativo', codigo_cnae_obrigatorio_nfse: true }

  beforeEach(() => { process.env.FOCUS_NFE_PARTNER_TOKEN = 'token-conta' })
  afterEach(() => { delete process.env.FOCUS_NFE_PARTNER_TOKEN })

  it('regra pura: MEI ignora a cidade; os demais seguem a decisão; sem decisão fica pendente', () => {
    assert.equal(rotaNfseDaAtivacao(['NFSE'], { codigo_regime_tributario: 4 }, 'MUNICIPAL'), 'NACIONAL')
    assert.equal(rotaNfseDaAtivacao(['NFSE'], EMITENTE, 'MUNICIPAL'), 'MUNICIPAL')
    assert.equal(rotaNfseDaAtivacao(['NFSE'], EMITENTE, 'NACIONAL'), 'NACIONAL')
    assert.equal(rotaNfseDaAtivacao(['NFSE'], EMITENTE, 'DESCONHECIDA'), 'MUNICIPAL_PENDENTE')
    assert.equal(rotaNfseDaAtivacao(['NFE'], EMITENTE, 'MUNICIPAL'), null)
  })

  it('cidade nova entra como DESCONHECIDA, com o cache da Focus, e a ficha fica pendente', async () => {
    const { onboarding, focus, ficha } = prepararCenario({})
    focus.quando('consultarMunicipio', FOCUS_IGUATU)
      .quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)

    const r = await onboarding.ativarEmissao(LICENCA, ['NFE', 'NFSE'], dados())

    assert.equal(r.nfse, 'MUNICIPAL_PENDENTE')
    assert.equal(tabelas.municipioNfse[0].rotaNaoMei, 'DESCONHECIDA')
    assert.equal(tabelas.municipioNfse[0].statusNfse, 'ativo')
    assert.deepEqual(tabelas.municipioNfse[0].obrigatorios, { codigo_cnae: true })
    assert.equal(ficha().nfseRota, 'MUNICIPAL_PENDENTE')
    assert.equal(ficha().nfseCodigoMunicipio, IGUATU)
  })

  it('cidade MUNICIPAL: liga habilita_nfse, desliga a Nacional e manda o login da prefeitura (fora do log)', async () => {
    const { onboarding, focus, ficha } = prepararCenario({})
    tabelas.municipioNfse.push({ codigoIbge: IGUATU, nome: 'Iguatu', uf: 'CE', rotaNaoMei: 'MUNICIPAL', exigeLoginPrefeitura: true, consultadoFocusEm: new Date() })
    focus.quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)

    const linhas: string[] = []
    const espiao = (m: unknown) => { linhas.push(String(m)) }
    const orig = { log: Logger.prototype.log, warn: Logger.prototype.warn, error: Logger.prototype.error }
    Logger.prototype.log = espiao as any; Logger.prototype.warn = espiao as any; Logger.prototype.error = espiao as any
    let r: any
    try {
      r = await onboarding.ativarEmissao(LICENCA, ['NFSE'], dados({ nfse_login_prefeitura: 'loja.iguatu', nfse_senha_prefeitura: 'segredo-prefeitura' }))
    } finally {
      Object.assign(Logger.prototype, orig)
    }

    assert.equal(r.nfse, 'MUNICIPAL')
    assert.equal(r.nfse_exige_login, true)
    assert.equal(focus.chamadasDe('consultarMunicipio').length, 0)   // cache do dia
    const [, , corpo] = focus.chamadasDe('atualizarEmpresa')[0].args
    assert.equal(corpo.habilita_nfse, true)
    assert.equal(corpo.habilita_nfsen_producao, false)
    assert.equal(corpo.login_responsavel, 'loja.iguatu')
    assert.equal(corpo.senha_responsavel, 'segredo-prefeitura')
    assert.equal(ficha().nfseRota, 'MUNICIPAL')
    assert.equal(linhas.some(l => l.includes('segredo-prefeitura') || l.includes('loja.iguatu')), false)
  })

  it('login da prefeitura não vai quando a rota não é municipal', async () => {
    const { onboarding, focus } = prepararCenario({})
    tabelas.municipioNfse.push({ codigoIbge: IGUATU, nome: 'Iguatu', uf: 'CE', rotaNaoMei: 'NACIONAL', consultadoFocusEm: new Date() })
    focus.quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)
    const r = await onboarding.ativarEmissao(LICENCA, ['NFSE'], dados({ nfse_login_prefeitura: 'x', nfse_senha_prefeitura: 'y' }))
    assert.equal(r.nfse, 'NACIONAL')
    const [, , corpo] = focus.chamadasDe('atualizarEmpresa')[0].args
    assert.equal('login_responsavel' in corpo, false)
    assert.equal('habilita_nfse' in corpo, false)
  })

  it('reativar com a cidade sem decisão não desfaz a rota que a ficha já tem', async () => {
    const { onboarding, focus, ficha } = prepararCenario({ nfseRota: 'MUNICIPAL' })
    tabelas.municipioNfse.push({ codigoIbge: IGUATU, nome: 'Iguatu', uf: 'CE', rotaNaoMei: 'DESCONHECIDA', consultadoFocusEm: new Date() })
    focus.quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)
    const r = await onboarding.ativarEmissao(LICENCA, ['NFSE'], dados())
    assert.equal(r.nfse, 'MUNICIPAL')
    assert.equal(ficha().nfseRota, 'MUNICIPAL')
  })

  it('Focus fora do ar na consulta da cidade não derruba a ativação', async () => {
    const { onboarding, focus } = prepararCenario({})
    focus.quando('consultarMunicipio', falhaHttp(502))
      .quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)
    const r = await onboarding.ativarEmissao(LICENCA, ['NFSE'], dados())
    assert.equal(r.status, 'ATIVO')
    assert.equal(r.nfse, 'MUNICIPAL_PENDENTE')
  })

  it('ERP sem código IBGE: a cidade é achada por nome + UF', async () => {
    const { onboarding, focus, ficha } = prepararCenario({})
    const semCodigo = { ...EMITENTE, endereco: { ...EMITENTE.endereco, codigo_municipio: undefined } }
    focus.quando('buscarMunicipioPorNome', { codigo_municipio: IGUATU, nome_municipio: 'Iguatu', sigla_uf: 'CE' })
      .quando('consultarMunicipio', FOCUS_IGUATU)
      .quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)
    await onboarding.ativarEmissao(LICENCA, ['NFSE'], dados({ emitente: semCodigo }))
    assert.deepEqual(focus.chamadasDe('buscarMunicipioPorNome')[0].args.slice(1), ['Iguatu', 'CE'])
    assert.equal(ficha().nfseCodigoMunicipio, IGUATU)
  })

  it('sem NFSE na licença, nada de cidade nem de rota', async () => {
    const { onboarding, focus, ficha } = prepararCenario({})
    focus.quando('buscarEmpresaPorCnpj', { id: 1 }).quando('atualizarEmpresa', RESPOSTA)
    await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())
    assert.equal(focus.chamadasDe('consultarMunicipio').length, 0)
    assert.equal(tabelas.municipioNfse.length, 0)
    assert.equal(ficha().nfseRota, null)
  })
})

describe('Emissão pela rota da ficha', () => {
  const dps = () => ({ cnpj_prestador: CNPJ, descricao_servico: 'Serviço', valor_servico: 100 })
  const NAO_ENCONTRADA = falhaHttp(404, { codigo: 'nao_encontrado' })

  it('MUNICIPAL: consulta e emite por /nfse, nada pela Nacional', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp', nfseRota: 'MUNICIPAL' })
    focus.quando('consultarNfseMunicipal', NAO_ENCONTRADA)
      .quando('emitirNfseMunicipal', { status: 'autorizado', numero: '12', codigo_verificacao: 'XYZ' })
    const r = await nfse.emitir(LICENCA, 'os-1-nfse', dps())
    assert.equal(r.status, 'autorizado')
    assert.equal(r.codigo_verificacao, 'XYZ')
    assert.equal(focus.chamadasDe('emitirNfsen').length, 0)
    assert.equal(focus.chamadasDe('consultarNfsen').length, 0)
    assert.equal(tabelas.consumoFiscal[0].tipoDocumento, 'NFSE')
  })

  it('MUNICIPAL: consulta e cancela por /nfse', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp', nfseRota: 'MUNICIPAL' })
    focus.quando('consultarNfseMunicipal', { status: 'autorizado', numero: '12' })
      .quando('cancelarNfseMunicipal', { status: 'cancelado' })
    assert.equal((await nfse.consultar(LICENCA, 'os-1-nfse')).numero, 12)
    assert.equal((await nfse.cancelar(LICENCA, 'os-1-nfse', 'Serviço lançado em duplicidade')).status, 'cancelado')
  })

  it('MUNICIPAL_PENDENTE: 422 NFSE_ROTA_PENDENTE e nada enviado', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp', nfseRota: 'MUNICIPAL_PENDENTE' })
    await assert.rejects(nfse.emitir(LICENCA, 'os-1-nfse', dps()), ehHttp(422, 'NFSE_ROTA_PENDENTE'))
    assert.equal(focus.chamadas.length, 0)
  })

  it('ficha sem rota (anterior à G6) continua pela Nacional', async () => {
    const { nfse, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultarNfsen', NAO_ENCONTRADA).quando('emitirNfsen', { status: 'processando_autorizacao' })
    await nfse.emitir(LICENCA, 'os-1-nfse', dps())
    assert.equal(focus.chamadasDe('emitirNfsen').length, 1)
  })
})

describe('Cidades: exigências para o ERP e admin', () => {
  beforeEach(() => { process.env.FOCUS_NFE_PARTNER_TOKEN = 'token-conta' })
  afterEach(() => { delete process.env.FOCUS_NFE_PARTNER_TOKEN })

  it('cache da Focus: tira o sufixo dos *_obrigatorio_nfse e guarda null quando a Focus não sabe', () => {
    const c = cacheDaFocus({ status_nfse: 'ativo', provedor_nfse: 'ISSNet', codigo_cnae_obrigatorio_nfse: true, endereco_obrigatorio_nfse: null, possui_cancelamento_nfse: false })
    assert.deepEqual(c.obrigatorios, { codigo_cnae: true, endereco: null })
    assert.equal(c.possuiCancelamento, false)
    assert.equal(c.requerCertificado, null)
  })

  it('código do emitente: só 7 dígitos', () => {
    assert.equal(codigoIbgeDoEmitente({ endereco: { codigo_municipio: '2305506' } }), IGUATU)
    assert.equal(codigoIbgeDoEmitente({ endereco: { codigo_municipio: '230550' } }), null)
    assert.equal(codigoIbgeDoEmitente(undefined), null)
  })

  it('exigências: rota da ficha e o que a cidade pede; cache velho é renovado', async () => {
    const { municipios, focus } = prepararCenario({ nfseRota: 'MUNICIPAL', nfseCodigoMunicipio: IGUATU })
    const ontem = new Date(Date.now() - 25 * 60 * 60 * 1000)
    tabelas.municipioNfse.push({ codigoIbge: IGUATU, nome: 'Iguatu', uf: 'CE', rotaNaoMei: 'MUNICIPAL', exigeLoginPrefeitura: true, consultadoFocusEm: ontem, obrigatorios: {} })
    focus.quando('consultarMunicipio', { codigo_municipio: IGUATU, nome_municipio: 'Iguatu', sigla_uf: 'CE', status_nfse: 'ativo', codigo_tributario_municipio_obrigatorio_nfse: true })

    const r = await municipios.exigenciasDaLicenca(LICENCA)

    assert.equal(r.rota, 'MUNICIPAL')
    assert.equal(r.municipio?.exige_login, true)
    assert.deepEqual(r.municipio?.obrigatorios, { codigo_tributario_municipio: true })
    assert.equal(tabelas.municipioNfse[0].rotaNaoMei, 'MUNICIPAL')   // a decisão do suporte fica
  })

  it('exigências sem cidade: rota NACIONAL (ficha antiga) e municipio null', async () => {
    const { municipios } = prepararCenario({})
    assert.deepEqual(await municipios.exigenciasDaLicenca(LICENCA), { rota: 'NACIONAL', municipio: null })
  })

  it('trocar a rota da ficha reconfigura a Focus com as duas chaves explícitas', async () => {
    const { municipios, focus, ficha } = prepararCenario({ focusEmpresaId: '77', nfseRota: 'MUNICIPAL_PENDENTE' })
    focus.quando('atualizarEmpresa', {})
    await municipios.trocarRotaDaFicha(CLIENTE, 'MUNICIPAL')
    const [token, id, corpo] = focus.chamadasDe('atualizarEmpresa')[0].args
    assert.deepEqual([token, id], ['token-conta', '77'])
    assert.deepEqual(corpo, { habilita_nfse: true, habilita_nfsen_producao: false, habilita_nfsen_homologacao: false })
    assert.equal(ficha().nfseRota, 'MUNICIPAL')
  })

  it('trocar a rota sem empresa na Focus: 400 e nada enviado', async () => {
    const { municipios, focus } = prepararCenario({})
    await assert.rejects(municipios.trocarRotaDaFicha(CLIENTE, 'NACIONAL'), ehHttp(400, 'SEM_EMPRESA_NA_FOCUS'))
    assert.equal(focus.chamadas.length, 0)
  })

  it('decidir guarda a escolha do suporte; cidade inexistente é 404', async () => {
    const { municipios } = prepararCenario({})
    tabelas.municipioNfse.push({ codigoIbge: IGUATU, nome: 'Iguatu', uf: 'CE', rotaNaoMei: 'DESCONHECIDA', exigeLoginPrefeitura: false })
    await municipios.decidir(IGUATU, { rotaNaoMei: 'MUNICIPAL', observacao: '  não MEI vai pela municipal  ' })
    assert.equal(tabelas.municipioNfse[0].rotaNaoMei, 'MUNICIPAL')
    assert.equal(tabelas.municipioNfse[0].observacao, 'não MEI vai pela municipal')
    await assert.rejects(municipios.decidir(ICO, { rotaNaoMei: 'NACIONAL' }), ehHttp(404))
  })
})
