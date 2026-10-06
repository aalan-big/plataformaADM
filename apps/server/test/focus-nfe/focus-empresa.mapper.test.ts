import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { camposFaltandoParaCriar, emitenteParaCadastroFocus } from '../../src/common/focus-nfe/focus-empresa.mapper'

/** O bloco `emitente{}` exatamente como o ERP monta para as notas. */
const EMITENTE = {
  cnpj: '58348941000109',
  razao_social: '58.348.941 CELSO PEREZ RIBEIRA',
  nome_fantasia: '',
  inscricao_estadual: '151815563116',
  inscricao_municipal: null,
  codigo_regime_tributario: 4,
  regime_tributario: 'MEI',
  endereco: {
    logradouro: 'R JOSE GOMES DE GOUVEIA', numero: '10', complemento: 'TERREO',
    bairro: 'VILA NOVA GALVAO', cidade: 'SAO PAULO', uf: 'sp', cep: '02280-120',
  },
}

describe('emitenteParaCadastroFocus', () => {
  it('traduz para os nomes do cadastro de empresas da Focus', () => {
    const corpo = emitenteParaCadastroFocus(EMITENTE, { email: 'a@b.com', telefone: '(11) 2231-2688' })
    assert.deepEqual(corpo, {
      cnpj: '58348941000109',
      nome: '58.348.941 CELSO PEREZ RIBEIRA',
      nome_fantasia: '58.348.941 CELSO PEREZ RIBEIRA',
      inscricao_estadual: '151815563116',
      regime_tributario: 4,
      logradouro: 'R JOSE GOMES DE GOUVEIA',
      numero: '10',
      complemento: 'TERREO',
      bairro: 'VILA NOVA GALVAO',
      municipio: 'SAO PAULO',
      uf: 'SP',
      cep: '02280120',
      email: 'a@b.com',
      telefone: '1122312688',
    })
  })

  it('não manda campo vazio (no PUT ele apagaria o que está certo na Focus)', () => {
    const corpo = emitenteParaCadastroFocus({ cnpj: '58348941000109', codigo_regime_tributario: 1 })
    assert.deepEqual(Object.keys(corpo).sort(), ['cnpj', 'regime_tributario'])
  })

  it('o rótulo de texto do regime não vai: quem decide é o número', () => {
    const corpo = emitenteParaCadastroFocus(EMITENTE)
    assert.equal(corpo.regime_tributario, 4)
  })
})

describe('camposFaltandoParaCriar', () => {
  it('emitente completo não falta nada', () => {
    assert.deepEqual(camposFaltandoParaCriar(EMITENTE), [])
  })

  it('lista tudo o que falta de uma vez, em português de tela', () => {
    const faltam = camposFaltandoParaCriar({ cnpj: '123', codigo_regime_tributario: 9, endereco: { uf: 'S' } })
    assert.deepEqual(faltam, ['CNPJ', 'razão social', 'regime tributário', 'logradouro', 'número', 'bairro', 'cidade', 'UF', 'CEP'])
  })
})
