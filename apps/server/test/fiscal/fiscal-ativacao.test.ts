/**
 * F2 do plano de refatoração do fiscal: "Ativar emissão" num passo só.
 *
 * O caso que motivou: o primeiro cliente em produção precisou cadastrar a
 * empresa à mão no painel da Focus, criar a ficha no admin, colar id e token e
 * reenviar o certificado (06/10/2026).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'crypto'
import { tabelas } from '../apoio/prisma-falso'
import { prepararCenario, falhaHttp, ehHttp, LICENCA, CNPJ } from '../apoio/cenario-fiscal'
import { decifrar } from '../../src/common/cripto/segredo-fiscal'

const EMITENTE = {
  cnpj: CNPJ,
  razao_social: '58.348.941 CELSO PEREZ RIBEIRA',
  inscricao_estadual: '151815563116',
  codigo_regime_tributario: 4,
  endereco: {
    logradouro: 'R JOSE GOMES DE GOUVEIA', numero: '10', bairro: 'VILA NOVA GALVAO',
    cidade: 'SAO PAULO', uf: 'SP', cep: '02280120',
  },
}

const dados = (emitente: Record<string, any> = EMITENTE) => ({
  emitente, email: 'loja@x.com', telefone: '11 2231-2688', arquivo_base64: 'MIIPFX', senha: 'senha-do-pfx',
})

const RESPOSTA_FOCUS = {
  id: 268251,
  cnpj: CNPJ,
  token_producao: 'tp-real',
  token_homologacao: 'th-real',
  certificado_valido_ate: '2027-09-08T18:40:00Z',
}

const NAO_ENCONTRADA = falhaHttp(404, { codigo: 'nao_encontrado' })

describe('Fiscal — ativarEmissao', () => {
  beforeEach(() => {
    process.env.FOCUS_NFE_PARTNER_TOKEN = 'token-conta'
    process.env.FISCAL_TOKENS_KEY = randomBytes(32).toString('base64')
  })
  afterEach(() => {
    delete process.env.FOCUS_NFE_PARTNER_TOKEN
    delete process.env.FISCAL_TOKENS_KEY
  })

  describe('sem ficha no admin', () => {
    it('licença sem NFE/NFCE explícito: 404 e nada criado — nem ficha, nem empresa na Focus', async () => {
      for (const claim of [undefined, [], ['FINANCEIRO']]) {
        const { onboarding, emissao, focus } = prepararCenario(null)
        await assert.rejects(onboarding.ativarEmissao(LICENCA, claim as any, dados()), ehHttp(404, 'SEM_CONFIGURACAO_FISCAL'))
        assert.equal(tabelas.empresaFiscalConfig.length, 0)
        assert.equal(focus.chamadas.length, 0)
      }
    })

    it('licença com NFE: a ficha nasce em PRODUÇÃO e a empresa é CRIADA na Focus', async () => {
      const { onboarding, emissao, focus, ficha } = prepararCenario(null)
      focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA_FOCUS)

      const r = await onboarding.ativarEmissao(LICENCA, ['FINANCEIRO', 'NFE'], dados())

      assert.equal(r.empresa, 'CRIADA')
      assert.equal(r.ambienteNome, 'Producao')
      assert.equal(ficha().ambiente, 1)
      assert.equal(ficha().cnpj, CNPJ)
      assert.equal(ficha().focusEmpresaId, '268251')
      assert.equal(ficha().certificadoStatus, 'ATIVO')

      const [tokenConta, corpo] = focus.chamadasDe('criarEmpresa')[0].args
      assert.equal(tokenConta, 'token-conta')
      assert.equal(corpo.municipio, 'SAO PAULO')
      assert.equal(corpo.regime_tributario, 4)
      assert.equal(corpo.arquivo_certificado_base64, 'MIIPFX')
      assert.equal(corpo.senha_certificado, 'senha-do-pfx')
      assert.equal(corpo.habilita_nfe, true)
      assert.equal(corpo.habilita_nfce, true)
    })

    it('CNPJ que já é de outro cliente: 409, nada na Focus', async () => {
      const { onboarding, emissao, focus } = prepararCenario(null)
      tabelas.empresaFiscalConfig.push({ clienteId: 'outro', cnpj: CNPJ, ambiente: 1 })
      await assert.rejects(onboarding.ativarEmissao(LICENCA, ['NFE'], dados()), ehHttp(409, 'CNPJ_DE_OUTRO_CLIENTE'))
      assert.equal(focus.chamadas.length, 0)
    })
  })

  describe('tokens', () => {
    it('grava os DOIS tokens cifrados e tira o texto puro', async () => {
      const { onboarding, emissao, focus, ficha } = prepararCenario({ focusEmpresaToken: 'colado-antes' })
      focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA_FOCUS)
      await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())

      assert.equal(ficha().focusEmpresaToken, null)
      assert.equal(decifrar(ficha().focusTokenProducao), 'tp-real')
      assert.equal(decifrar(ficha().focusTokenHomologacao), 'th-real')
      assert.equal(String(ficha().focusTokenProducao).includes('tp-real'), false)
    })

    it('a emissão seguinte usa o token cifrado do ambiente da ficha', async () => {
      const { onboarding, emissao, focus } = prepararCenario()
      focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA_FOCUS)
      await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())

      focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', { status: 'autorizado' })
      await emissao.emitir(LICENCA, 'venda-1', { emitente: { cnpj: CNPJ }, items: [] })
      assert.equal(focus.chamadasDe('emitir')[0].args[0], 'tp-real')
    })

    it('trocar a ficha para homologação passa a usar o token de homologação, sem reenviar nada', async () => {
      const { onboarding, emissao, focus, ficha } = prepararCenario()
      focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA_FOCUS)
      await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())

      ficha().ambiente = 2
      focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', { status: 'autorizado' })
      await emissao.emitir(LICENCA, 'teste-1', { emitente: { cnpj: CNPJ }, items: [] })
      const [token, , , , ambiente] = focus.chamadasDe('emitir')[0].args
      assert.deepEqual([token, ambiente], ['th-real', 2])
    })

    it('token colado à mão pelo admin vence o cifrado', async () => {
      const { onboarding, emissao, focus, ficha } = prepararCenario()
      focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA_FOCUS)
      await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())

      ficha().focusEmpresaToken = 'colado-pelo-admin'
      focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', { status: 'autorizado' })
      await emissao.emitir(LICENCA, 'venda-1', { emitente: { cnpj: CNPJ }, items: [] })
      assert.equal(focus.chamadasDe('emitir')[0].args[0], 'colado-pelo-admin')
    })

    it('sem FISCAL_TOKENS_KEY: comportamento antigo, token do ambiente em texto', async () => {
      delete process.env.FISCAL_TOKENS_KEY
      const { onboarding, emissao, focus, ficha } = prepararCenario()
      focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA_FOCUS)
      const r = await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())

      assert.equal(ficha().focusEmpresaToken, 'tp-real')
      assert.equal(ficha().focusTokenProducao, null)
      assert.equal(r.tokenConfigurado, true)
    })

    it('a resposta ao ERP não traz token nenhum', async () => {
      const { onboarding, emissao, focus } = prepararCenario()
      focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA_FOCUS)
      const r = await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())
      const texto = JSON.stringify(r)
      assert.equal(texto.includes('tp-real') || texto.includes('th-real') || texto.includes('senha'), false)
    })
  })

  describe('empresa que já existe na Focus', () => {
    it('com id na ficha: ATUALIZA, sem procurar nem criar', async () => {
      const { onboarding, emissao, focus } = prepararCenario({ focusEmpresaId: '268251' })
      focus.quando('atualizarEmpresa', RESPOSTA_FOCUS)
      const r = await onboarding.ativarEmissao(LICENCA, undefined, dados())
      assert.equal(r.empresa, 'ATUALIZADA')
      assert.equal(focus.chamadasDe('atualizarEmpresa')[0].args[1], '268251')
      assert.equal(focus.chamadasDe('buscarEmpresaPorCnpj').length, 0)
      assert.equal(focus.chamadasDe('criarEmpresa').length, 0)
    })

    it('achada pelo CNPJ: atualiza aquela, nunca cria outra', async () => {
      const { onboarding, emissao, focus, ficha } = prepararCenario()
      focus.quando('buscarEmpresaPorCnpj', { id: 77, cnpj: CNPJ }).quando('atualizarEmpresa', RESPOSTA_FOCUS)
      await onboarding.ativarEmissao(LICENCA, undefined, dados())
      assert.equal(focus.chamadasDe('criarEmpresa').length, 0)
      assert.equal(ficha().focusEmpresaId, '77')
    })

    it('na atualização, endereço incompleto não barra (a empresa já existe lá)', async () => {
      const { onboarding, emissao, focus } = prepararCenario({ focusEmpresaId: '268251' })
      focus.quando('atualizarEmpresa', RESPOSTA_FOCUS)
      const r = await onboarding.ativarEmissao(LICENCA, undefined, dados({ cnpj: CNPJ, codigo_regime_tributario: 4 }))
      assert.equal(r.empresa, 'ATUALIZADA')
    })
  })

  describe('recusas', () => {
    it('CNPJ do ERP diferente da ficha: 422 e nada na Focus', async () => {
      const { onboarding, emissao, focus } = prepararCenario()
      await assert.rejects(
        onboarding.ativarEmissao(LICENCA, ['NFE'], dados({ ...EMITENTE, cnpj: '11222333000181' })),
        ehHttp(422, 'CNPJ_DIVERGENTE'),
      )
      assert.equal(focus.chamadas.length, 0)
    })

    it('para CRIAR, endereço incompleto: 422 com a lista inteira, sem chamar a Focus para criar', async () => {
      const { onboarding, emissao, focus } = prepararCenario()
      focus.quando('buscarEmpresaPorCnpj', null)
      await assert.rejects(
        onboarding.ativarEmissao(LICENCA, ['NFE'], dados({ cnpj: CNPJ, razao_social: 'X', codigo_regime_tributario: 4 })),
        (e: any) => ehHttp(422, 'DADOS_INCOMPLETOS')(e) && /logradouro.*CEP/.test(e.getResponse().mensagem),
      )
      assert.equal(focus.chamadasDe('criarEmpresa').length, 0)
    })

    it('validação da Focus (senha, município…): 422 com as mensagens dela e sem a senha', async () => {
      const { onboarding, emissao, focus, ficha } = prepararCenario()
      focus
        .quando('buscarEmpresaPorCnpj', null)
        .quando('criarEmpresa', falhaHttp(422, {
          codigo: 'erro_validacao', mensagem: 'Erro de validação',
          erros: [{ mensagem: 'Senha do certificado inválida' }, { mensagem: 'Senha do certificado inválida' }],
        }))
      await assert.rejects(
        onboarding.ativarEmissao(LICENCA, ['NFE'], dados()),
        (e: any) => {
          const m = e.getResponse().mensagem as string
          return ehHttp(422, 'EMISSORA_RECUSOU')(e) && m.includes('Senha do certificado inválida') &&
            m.split('Senha').length === 2 && !m.includes('senha-do-pfx')
        },
      )
      assert.equal(ficha().certificadoStatus, 'AUSENTE')
    })

    it('401 da Focus é o NOSSO token: 501, nunca "certificado recusado"', async () => {
      const { onboarding, emissao, focus } = prepararCenario()
      focus.quando('buscarEmpresaPorCnpj', falhaHttp(401))
      await assert.rejects(onboarding.ativarEmissao(LICENCA, ['NFE'], dados()), ehHttp(501, 'PLATAFORMA_SEM_TOKEN_DA_CONTA'))
    })

    it('sem token de parceiro no .env: 501 sem falar com a Focus', async () => {
      delete process.env.FOCUS_NFE_PARTNER_TOKEN
      const { onboarding, emissao, focus } = prepararCenario()
      await assert.rejects(onboarding.ativarEmissao(LICENCA, ['NFE'], dados()), ehHttp(501, 'PLATAFORMA_SEM_TOKEN_DA_CONTA'))
      assert.equal(focus.chamadas.length, 0)
    })

    it('emitente sem CNPJ: 400', async () => {
      const { onboarding, emissao } = prepararCenario()
      await assert.rejects(onboarding.ativarEmissao(LICENCA, ['NFE'], dados({ razao_social: 'X' })), ehHttp(400, 'EMITENTE_SEM_CNPJ'))
    })
  })

  it('configFiscal enxerga o token cifrado', async () => {
    const { onboarding, emissao, focus } = prepararCenario({ certificadoStatus: 'ATIVO', cscConfigurado: true })
    focus.quando('buscarEmpresaPorCnpj', null).quando('criarEmpresa', RESPOSTA_FOCUS)
    await onboarding.ativarEmissao(LICENCA, ['NFE'], dados())
    const c = await onboarding.configFiscal(LICENCA)
    assert.equal(c.tokenConfigurado, true)
    assert.deepEqual(c.pendencias, [])
  })
})
