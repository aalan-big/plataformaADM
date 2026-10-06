import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { traduzirPayloadParaFocus } from '../../src/common/focus-nfe/focus-payload.mapper'

/** 07/10/2026 01:30 UTC = 06/10/2026 22:30 em São Paulo — vira o dia em UTC. */
const AGORA = new Date('2026-10-07T01:30:00Z')

function payloadDoErp() {
  return {
    natureza_operacao: 'VENDA',
    numero: 2,
    serie: 1,
    emitente: {
      cnpj: '58348941000109',
      razao_social: '58.348.941 CELSO PEREZ RIBEIRA',
      inscricao_estadual: '151815563116',
      codigo_regime_tributario: 4,
      regime_tributario: 'MEI',
      endereco: { logradouro: 'R JOSE GOMES DE GOUVEIA', numero: '10', cidade: 'SAO PAULO', uf: 'SP', cep: '02280120' },
    },
    destinatario: {
      cpf: '12345678909',
      nome: 'COMPRADORA',
      indicador_ie: '9',
      endereco: { logradouro: 'RUA X', numero: '1', bairro: 'CENTRO', cidade: 'BELO HORIZONTE', uf: 'MG', cep: '30110000' },
    },
    totais: { valor_produtos: 100, valor_total: 100, icms_base_calculo: 0 },
    items: [
      { numero_item: 1, cfop: '6108', ncm: '61091000', valor_bruto: 100, icms_situacao_tributaria: '102' },
    ],
  }
}

describe('traduzirPayloadParaFocus', () => {
  it('leva o CRT numérico do emitente para regime_tributario_emitente (o campo da Rejeição 481)', () => {
    const saida = traduzirPayloadParaFocus(payloadDoErp(), AGORA)
    assert.equal(saida.regime_tributario_emitente, 4)
    // O rótulo de texto é o único descarte do tradutor: não tem par na Focus.
    assert.equal('regime_tributario' in saida, false)
    assert.equal('emitente' in saida, false)
  })

  it('achata emitente e endereço do emitente com sufixo', () => {
    const saida = traduzirPayloadParaFocus(payloadDoErp(), AGORA)
    assert.equal(saida.cnpj_emitente, '58348941000109')
    assert.equal(saida.nome_emitente, '58.348.941 CELSO PEREZ RIBEIRA')
    assert.equal(saida.inscricao_estadual_emitente, '151815563116')
    assert.equal(saida.logradouro_emitente, 'R JOSE GOMES DE GOUVEIA')
    assert.equal(saida.municipio_emitente, 'SAO PAULO')
    assert.equal(saida.uf_emitente, 'SP')
  })

  it('traduz o indicador de IE do destinatário para o nome por extenso da Focus', () => {
    const saida = traduzirPayloadParaFocus(payloadDoErp(), AGORA)
    assert.equal(saida.indicador_inscricao_estadual_destinatario, '9')
    assert.equal(saida.cpf_destinatario, '12345678909')
    assert.equal(saida.municipio_destinatario, 'BELO HORIZONTE')
    assert.equal(saida.uf_destinatario, 'MG')
  })

  it('sobe os totais para a raiz sem tabela de tradução', () => {
    const saida = traduzirPayloadParaFocus(payloadDoErp(), AGORA)
    assert.equal(saida.valor_total, 100)
    assert.equal(saida.valor_produtos, 100)
    // 0 é valor fiscal legítimo e não pode sumir como se fosse vazio.
    assert.equal(saida.icms_base_calculo, 0)
    assert.equal('totais' in saida, false)
  })

  it('troca ncm por codigo_ncm nos itens e preserva o resto do item', () => {
    const saida = traduzirPayloadParaFocus(payloadDoErp(), AGORA) as any
    assert.equal(saida.items[0].codigo_ncm, '61091000')
    assert.equal('ncm' in saida.items[0], false)
    assert.equal(saida.items[0].cfop, '6108')
    assert.equal(saida.items[0].icms_situacao_tributaria, '102')
  })

  it('não sobrescreve codigo_ncm que já veio plano', () => {
    const p = payloadDoErp() as any
    p.items[0].codigo_ncm = '99999999'
    const saida = traduzirPayloadParaFocus(p, AGORA) as any
    assert.equal(saida.items[0].codigo_ncm, '99999999')
  })

  it('preenche data_emissao no horário de São Paulo, com -03:00', () => {
    const saida = traduzirPayloadParaFocus(payloadDoErp(), AGORA)
    assert.equal(saida.data_emissao, '2026-10-06T22:30:00-03:00')
  })

  it('não troca data_emissao que o ERP já mandou', () => {
    const p = { ...payloadDoErp(), data_emissao: '2026-10-01T10:00:00-03:00' }
    const saida = traduzirPayloadParaFocus(p, AGORA)
    assert.equal(saida.data_emissao, '2026-10-01T10:00:00-03:00')
  })

  it('campo plano na raiz vence o aninhado (retrocompatível)', () => {
    const p = { ...payloadDoErp(), regime_tributario_emitente: 1 }
    const saida = traduzirPayloadParaFocus(p, AGORA)
    assert.equal(saida.regime_tributario_emitente, 1)
  })

  it('é idempotente: traduzir duas vezes dá o mesmo resultado', () => {
    const uma = traduzirPayloadParaFocus(payloadDoErp(), AGORA)
    const duas = traduzirPayloadParaFocus(uma, AGORA)
    assert.deepEqual(duas, uma)
  })

  it('não altera o objeto recebido', () => {
    const p = payloadDoErp()
    const antes = JSON.stringify(p)
    traduzirPayloadParaFocus(p, AGORA)
    assert.equal(JSON.stringify(p), antes)
  })

  it('endereço do transportador é texto e vira endereco_transportador', () => {
    const p = {
      ...payloadDoErp(),
      transportador: { cnpj: '11222333000181', razao_social: 'TRANSP', endereco: 'RUA Y, 2', cidade: 'SAO PAULO', uf: 'SP' },
    }
    const saida = traduzirPayloadParaFocus(p, AGORA)
    assert.equal(saida.endereco_transportador, 'RUA Y, 2')
    assert.equal(saida.nome_transportador, 'TRANSP')
    assert.equal(saida.municipio_transportador, 'SAO PAULO')
  })

  it('devolve como veio o que não é objeto', () => {
    assert.equal(traduzirPayloadParaFocus(null, AGORA), null)
    const lista = [1, 2]
    assert.equal(traduzirPayloadParaFocus(lista, AGORA), lista)
  })
})
