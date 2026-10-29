/**
 * DPS (NFS-e Nacional, o que o ERP manda) → NFS-e MUNICIPAL da Focus (`/v2/nfse`).
 * G6 da NFS-e no ERP (backend-fastapi/docs/nfse-fase2-plano.md).
 *
 * O ERP fala UM formato só, a DPS plana da Nacional (`cnpj_prestador`,
 * `codigo_tributacao_nacional_iss`, `*_tomador`...). Quando a cidade da empresa
 * emite pelo sistema da prefeitura, a mesma DPS é traduzida aqui para o formato
 * aninhado da Focus (`prestador{}`, `tomador{endereco{}}`, `servico{}`). Mesma
 * regra da NF-e (`focus-payload.mapper.ts`): a tradução mora na fronteira com a
 * Focus, e o ERP não sabe qual rota a cidade usa.
 *
 * Campos conferidos em doc.focusnfe.com.br/reference/emitir_nfse (29/10/2026).
 * Dois pontos que a própria doc deixa ambíguos e a homologação confirma:
 * - `item_lista_servico`: o exemplo do POST usa "0107", o schema "17.09".
 *   Vai sem ponto, como no exemplo da emissão; o ERP pode mandar o seu
 *   (`_municipal.item_lista_servico`) e ele vence.
 * - `aliquota`: o exemplo é 0.05 (fração). A DPS traz o percentual (5), que
 *   vai dividido por 100.
 *
 * Extensão: `_municipal{}` na DPS carrega o que só a rota municipal usa
 * (`codigo_cnae`, `item_lista_servico`). Nunca segue para a Focus — nem aqui,
 * nem na Nacional (o `semExtensaoMunicipal` tira antes do `/nfsen`).
 */

/** Sem acento, sem caixa, sem pontuação: "Iguatu" = "IGUATU", "D'Oeste" = "d oeste". */
export function normalizarNome(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Regime especial: a DPS usa a tabela NACIONAL (o ERP converteu do código
 * ABRASF do cadastro); a municipal usa a ABRASF de volta. MEI e ME/EPP do
 * Simples não são "regime especial" na Nacional, mas são na ABRASF (5 e 6).
 */
const REGIME_NACIONAL_PARA_ABRASF: Record<string, string> = { '1': '4', '2': '2', '3': '1', '6': '3' }

function regimeEspecialAbrasf(dps: Record<string, any>): string | undefined {
  const nacional = String(dps.regime_especial_tributacao ?? '0')
  if (REGIME_NACIONAL_PARA_ABRASF[nacional]) return REGIME_NACIONAL_PARA_ABRASF[nacional]
  const opcao = String(dps.codigo_opcao_simples_nacional ?? '1')
  if (opcao === '2') return '5'
  if (opcao === '3') return '6'
  return undefined
}

/** "010701" (código nacional, 6 dígitos) → "0107" (item da LC 116). */
function itemListaServico(dps: Record<string, any>, extensao: Record<string, any>): string | undefined {
  const doErp = String(extensao.item_lista_servico ?? '').trim()
  if (doErp) return doErp
  const nacional = String(dps.codigo_tributacao_nacional_iss ?? '').replace(/\D/g, '')
  return nacional.length >= 4 ? nacional.slice(0, 4) : undefined
}

const texto = (v: unknown) => (v === null || v === undefined ? undefined : String(v))
const so = (v: unknown) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d || undefined
}

/** Tira `undefined`, `null`, "" e objetos que ficaram vazios. */
function enxugar<T extends Record<string, any>>(obj: T): T {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      enxugar(v)
      if (Object.keys(v).length === 0) delete obj[k]
    } else if (v === undefined || v === null || v === '') {
      delete obj[k]
    }
  }
  return obj
}

/** A DPS sem a extensão municipal — o que a Nacional (`/nfsen`) recebe. */
export function semExtensaoMunicipal(dps: any): any {
  if (!dps || typeof dps !== 'object' || !('_municipal' in dps)) return dps
  const { _municipal, ...resto } = dps
  return resto
}

export function dpsParaNfseMunicipal(dps: Record<string, any>): Record<string, any> {
  const extensao: Record<string, any> = (dps?._municipal && typeof dps._municipal === 'object') ? dps._municipal : {}

  const municipioEmissora = texto(dps.codigo_municipio_emissora)
  const municipioPrestacao = texto(dps.codigo_municipio_prestacao) ?? municipioEmissora
  const percentual = Number(dps.percentual_aliquota_relativa_municipio)

  const tomador: Record<string, any> = {
    cpf:                 so(dps.cpf_tomador),
    cnpj:                so(dps.cnpj_tomador),
    inscricao_municipal: so(dps.inscricao_municipal_tomador),
    razao_social:        texto(dps.razao_social_tomador),
    email:               texto(dps.email_tomador),
    telefone:            so(dps.telefone_tomador),
    endereco: {
      logradouro:       texto(dps.logradouro_tomador),
      numero:           texto(dps.numero_tomador),
      complemento:      texto(dps.complemento_tomador),
      bairro:           texto(dps.bairro_tomador),
      codigo_municipio: texto(dps.codigo_municipio_tomador),
      uf:               texto(dps.uf_tomador),
      cep:              so(dps.cep_tomador),
    },
  }

  return enxugar({
    data_emissao: texto(dps.data_emissao),
    // 1 = tributação no município; 2 = fora dele (a instalação da marcenaria
    // numa obra de outra cidade, G5).
    natureza_operacao: municipioPrestacao && municipioEmissora && municipioPrestacao !== municipioEmissora ? '2' : '1',
    regime_especial_tributacao: regimeEspecialAbrasf(dps),
    optante_simples_nacional: String(dps.codigo_opcao_simples_nacional ?? '1') !== '1',
    prestador: {
      cnpj:                so(dps.cnpj_prestador),
      inscricao_municipal: so(dps.inscricao_municipal_prestador),
      codigo_municipio:    municipioEmissora,
    },
    tomador,
    servico: {
      valor_servicos:              dps.valor_servico,
      desconto_incondicionado:     dps.desconto_incondicionado,
      // 1 = não retido (tabela `tpRetISSQN` da DPS).
      iss_retido:                  String(dps.tipo_retencao_iss ?? '1') !== '1',
      item_lista_servico:          itemListaServico(dps, extensao),
      codigo_tributario_municipio: texto(dps.codigo_tributacao_municipal_iss),
      codigo_cnae:                 so(extensao.codigo_cnae),
      discriminacao:               texto(dps.descricao_servico),
      codigo_municipio:            municipioPrestacao,
      aliquota:                    Number.isFinite(percentual) && percentual > 0 ? Math.round(percentual * 100) / 10000 : undefined,
      // Reforma tributária: os mesmos nomes nos dois formatos.
      codigo_nbs:                       texto(dps.codigo_nbs),
      ibs_cbs_situacao_tributaria:      texto(dps.ibs_cbs_situacao_tributaria),
      ibs_cbs_classificacao_tributaria: texto(dps.ibs_cbs_classificacao_tributaria),
    },
  })
}
