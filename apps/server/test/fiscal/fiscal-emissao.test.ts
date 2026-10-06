/**
 * Emissão pela plataforma: travas antes da Focus, idempotência, cota e o
 * desfecho que volta ao ERP. Fotografa o comportamento de hoje (F0).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tabelas } from '../apoio/prisma-falso'
import { prepararCenario, falhaHttp, ehHttp, LICENCA, CNPJ, PLANO } from '../apoio/cenario-fiscal'

const NAO_ENCONTRADA = falhaHttp(404, { codigo: 'nao_encontrado' })
const payload = (cnpj = CNPJ) => ({ emitente: { cnpj, codigo_regime_tributario: 4 }, items: [] })

const REJEICAO_539 = {
  status: 'erro_autorizacao',
  status_sefaz: '539',
  mensagem_sefaz: 'Rejeição: Duplicidade de NF-e com diferença na Chave de Acesso [chNFe:35260958348941000109550020000000041750446210]',
  numero: '4',
  serie: '2',
}

const AUTORIZADA = {
  status: 'autorizado',
  status_sefaz: '100',
  mensagem_sefaz: 'Autorizado o uso da NF-e',
  chave_nfe: 'NFe35261058348941000109550010000000021000000000',
  protocolo_nota_fiscal: { numero_protocolo: '135260000000001' },
  numero: '2',
  serie: '1',
  caminho_danfe: '/arquivos/danfe.pdf',
  caminho_xml_nota_fiscal: '/arquivos/nota.xml',
}

describe('FiscalService — emitir', () => {
  it('sem token da empresa: 400 antes de falar com a Focus', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: null })
    await assert.rejects(servico.emitir(LICENCA, 'venda-1', payload()), ehHttp(400))
    assert.equal(focus.chamadas.length, 0)
  })

  it('CNPJ do emitente diferente da ficha: 400 e nada enviado', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    await assert.rejects(servico.emitir(LICENCA, 'venda-1', payload('11222333000181')), ehHttp(400))
    assert.equal(focus.chamadas.length, 0)
  })

  it('CNPJ com máscara no payload confere com a ficha', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
    const r = await servico.emitir(LICENCA, 'venda-1', payload('58.348.941/0001-09'))
    assert.equal(r.status, 'autorizado')
  })

  it('ref já existente na Focus devolve a nota existente sem emitir de novo', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultar', AUTORIZADA)
    const r = await servico.emitir(LICENCA, 'venda-1', payload())
    assert.equal(r.status, 'autorizado')
    assert.equal(focus.chamadasDe('emitir').length, 0)
  })

  it('status "nao_encontrado" com HTTP 200 libera a emissão', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultar', { status: 'nao_encontrado' }).quando('emitir', AUTORIZADA)
    await servico.emitir(LICENCA, 'venda-1', payload())
    assert.equal(focus.chamadasDe('emitir').length, 1)
  })

  it('não saber se a ref existe (Focus 500) aborta com 503 e NÃO emite', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultar', falhaHttp(500))
    await assert.rejects(servico.emitir(LICENCA, 'venda-1', payload()), ehHttp(503))
    assert.equal(focus.chamadasDe('emitir').length, 0)
  })

  it('emite com o token e o ambiente da ficha', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp', ambiente: 1 })
    focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
    await servico.emitir(LICENCA, 'venda-1', payload())
    const [token, recurso, ref, , ambiente] = focus.chamadasDe('emitir')[0].args
    assert.deepEqual([token, recurso, ref, ambiente], ['tp', 'nfe', 'venda-1', 1])
  })

  it('NFC-e vai pelo recurso nfce', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
    await servico.emitir(LICENCA, 'cupom-1', { cnpj_emitente: CNPJ }, 'NFCE')
    assert.equal(focus.chamadasDe('emitir')[0].args[1], 'nfce')
  })

  it('autorizada: devolve protocolo, chave e URLs absolutas de produção, e conta na cota', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp', ambiente: 1 })
    focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
    const r = await servico.emitir(LICENCA, 'venda-1', payload())
    assert.equal(r.status, 'autorizado')
    assert.equal(r.codigo_sefaz, 100)
    assert.equal(r.protocolo, '135260000000001')
    assert.equal(r.numero, 2)
    assert.equal(r.ambienteNome, 'Producao')
    assert.match(r.url_pdf ?? '', /^https:\/\/api\.focusnfe\.com\.br\/arquivos\/danfe\.pdf$/)
    assert.equal(tabelas.consumoFiscal[0].emitidas, 1)
    assert.equal(tabelas.emissaoLog[0].resultado, 'autorizado')
  })

  it('rejeição 539 volta como erro com cStat e mensagem, e NÃO conta na cota', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', REJEICAO_539)
    const r = await servico.emitir(LICENCA, 'venda-1-4', payload())
    assert.equal(r.status, 'erro')
    assert.equal(r.status_focus, 'erro_autorizacao')
    assert.equal(r.codigo_sefaz, 539)
    assert.match(r.mensagem_sefaz ?? '', /chNFe:3526095834894100010955002/)
    assert.equal(tabelas.consumoFiscal.length, 0)
    assert.equal(tabelas.emissaoLog[0].resultado, 'erro')
  })

  it('denegada fica separada de rejeitada pelo status_focus', async () => {
    const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
    focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', { status: 'denegado', status_sefaz: '302' })
    const r = await servico.emitir(LICENCA, 'venda-1', payload())
    assert.equal(r.status, 'erro')
    assert.equal(r.status_focus, 'denegado')
  })

  describe('cota', () => {
    it('produção com cota esgotada: 402 e nada vai à Focus', async () => {
      const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp', ambiente: 1 })
      tabelas.planoModulo.push({ planoId: PLANO, identificador: 'NFE', cotaMensal: 1 })
      const competencia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
      tabelas.consumoFiscal.push({ licencaId: LICENCA, competencia, ambiente: 1, tipoDocumento: 'NFE', emitidas: 1, canceladas: 0, cotaExtra: 0 })
      await assert.rejects(servico.emitir(LICENCA, 'venda-2', payload()), ehHttp(402))
      assert.equal(focus.chamadas.length, 0)
    })

    it('homologação não consulta nem consome cota', async () => {
      const { servico, focus } = prepararCenario({ focusEmpresaToken: 'th', ambiente: 2 })
      tabelas.planoModulo.push({ planoId: PLANO, identificador: 'NFE', cotaMensal: 0 })
      focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
      const r = await servico.emitir(LICENCA, 'teste-1', payload())
      assert.equal(r.ambienteNome, 'Homologacao')
      assert.match(r.url_pdf ?? '', /^https:\/\/homologacao\.focusnfe\.com\.br\//)
    })
  })

  describe('idempotência por chave', () => {
    it('mesma chave devolve a resposta gravada sem chamar a Focus', async () => {
      const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
      focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
      const primeira = await servico.emitir(LICENCA, 'venda-1', payload(), 'NFE', 'chave-1')
      const segunda = await servico.emitir(LICENCA, 'venda-1', payload(), 'NFE', 'chave-1')
      assert.deepEqual(segunda, primeira)
      assert.equal(focus.chamadasDe('emitir').length, 1)
    })

    it('chave reaproveitada para outra ref: 409', async () => {
      const { servico, focus } = prepararCenario({ focusEmpresaToken: 'tp' })
      focus.quando('consultar', NAO_ENCONTRADA).quando('emitir', AUTORIZADA)
      await servico.emitir(LICENCA, 'venda-1', payload(), 'NFE', 'chave-1')
      await assert.rejects(servico.emitir(LICENCA, 'venda-2', payload(), 'NFE', 'chave-1'), ehHttp(409))
    })
  })
})
