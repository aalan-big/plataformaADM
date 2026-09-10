/**
 * Tradutor do payload do ERP para o vocabulário da Focus NFe.
 *
 * O ERP monta a nota em objetos aninhados — `emitente{}`, `destinatario{}`,
 * `totais{}` —, que é como um humano desenha uma nota fiscal. A Focus recebe
 * tudo PLANO, com sufixo: `cnpj_emitente`, `nome_destinatario`, `valor_total`.
 * Sem esta tradução a Focus recebe três objetos que não conhece e ZERO campos
 * de emitente, destinatário e totais — a nota é recusada e o motivo aponta para
 * o ERP, que montou tudo certo.
 *
 * POR QUE A TRADUÇÃO MORA AQUI, e não no ERP: se o ERP falasse o vocabulário da
 * Focus, a plataforma deixaria de ser intermediária e trocar de emissora
 * passaria a exigir instalador novo em cada loja. Aqui, trocar de emissora é um
 * deploy nosso.
 *
 * PRINCÍPIO: este arquivo TRADUZ, não decide.
 *
 * Todo campo que tem destino na Focus é repassado. A versão antiga do schema
 * Zod descartava em silêncio o que não conhecia, e isso custou dias de "a SEFAZ
 * rejeitou por falta de campo obrigatório" apontando para quem não tinha tirado
 * nada. Um tradutor que poda o emitente repete exatamente esse erro por outro
 * mecanismo. O único campo descartado aqui é o rótulo de texto do regime
 * tributário, que não tem par na Focus — e ele está nomeado no código abaixo.
 *
 * IDEMPOTENTE E RETROCOMPATÍVEL: valor que já esteja plano na raiz nunca é
 * sobrescrito pelo aninhado, e rodar duas vezes dá o mesmo resultado. É isso que
 * permite o ERP passar a falar plano um dia sem derrubar as lojas que ainda não
 * atualizaram o instalador.
 *
 * Nomes conferidos em https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html e
 * https://doc.focusnfe.com.br/reference/emitir_nfe.md — exceto o grupo do
 * transportador, ver a ressalva em `MAPA_TRANSPORTADOR`.
 */

/** `emitente.<chave>` → campo plano na raiz. */
const MAPA_EMITENTE: Record<string, string> = {
  cnpj:                     'cnpj_emitente',
  cpf:                      'cpf_emitente',
  razao_social:             'nome_emitente',
  nome:                     'nome_emitente',
  nome_fantasia:            'nome_fantasia_emitente',
  inscricao_estadual:       'inscricao_estadual_emitente',
  inscricao_municipal:      'inscricao_municipal_emitente',
  // O CRT numérico (1..4). O ERP manda junto um `regime_tributario` de TEXTO
  // ("Simples Nacional") que é só rótulo de tela: não tem campo na Focus e é o
  // único descarte deste arquivo. Quem decide a tributação é este número.
  codigo_regime_tributario: 'regime_tributario_emitente',
  telefone:                 'telefone_emitente',
}

/** `destinatario.<chave>` → campo plano na raiz. */
const MAPA_DESTINATARIO: Record<string, string> = {
  cnpj:                'cnpj_destinatario',
  cpf:                 'cpf_destinatario',
  nome:                'nome_destinatario',
  razao_social:        'nome_destinatario',
  inscricao_estadual:  'inscricao_estadual_destinatario',
  inscricao_municipal: 'inscricao_municipal_destinatario',
  // indIEDest. O ERP chama de `indicador_ie`; a Focus quer o nome por extenso.
  indicador_ie:        'indicador_inscricao_estadual_destinatario',
  pais:                'pais_destinatario',
  telefone:            'telefone_destinatario',
}

/**
 * `<grupo>.endereco.<chave>` → raiz, com o sufixo do grupo.
 *
 * `cidade` e `municipio` apontam para o mesmo destino porque o ERP escreve
 * `cidade` e a Focus lê `municipio` — e aceitar os dois é o que faz este
 * tradutor continuar funcionando se o ERP renomear o campo dele.
 */
const MAPA_ENDERECO: Record<string, string> = {
  logradouro:  'logradouro',
  numero:      'numero',
  complemento: 'complemento',
  bairro:      'bairro',
  cidade:      'municipio',
  municipio:   'municipio',
  uf:          'uf',
  cep:         'cep',
  telefone:    'telefone',
}

/**
 * `transportador.<chave>` → campo plano na raiz.
 *
 * ⚠️ ÚNICO GRUPO DESTE ARQUIVO COM NOMES NÃO CONFERIDOS na tabela oficial: a
 * página de campos da Focus vem truncada antes do grupo `transporta`. Os nomes
 * abaixo seguem a convenção de sufixo de todos os outros grupos, que é
 * consistente na API inteira, mas são inferência.
 *
 * O alcance disso é estreito: o ERP só monta este grupo na NFC-e com entrega a
 * domicílio (indPres 4). Se estiverem errados, o sintoma é a rejeição 786
 * ("grupo transporta obrigatório") NESSE caso específico — venda de balcão,
 * NF-e e NFC-e comum não passam por aqui. Ao conferir, corrija este mapa.
 */
const MAPA_TRANSPORTADOR: Record<string, string> = {
  cnpj:               'cnpj_transportador',
  cpf:                'cpf_transportador',
  razao_social:       'nome_transportador',
  nome:               'nome_transportador',
  inscricao_estadual: 'inscricao_estadual_transportador',
  endereco:           'endereco_transportador',
  municipio:          'municipio_transportador',
  cidade:             'municipio_transportador',
  uf:                 'uf_transportador',
}

/** Vazio de verdade. `0` e `false` são valores fiscais legítimos e ficam. */
function vazio(valor: unknown): boolean {
  return valor === null || valor === undefined || valor === ''
}

/**
 * Escreve na raiz sem nunca sobrescrever o que já está lá.
 *
 * É esta regra que torna o tradutor idempotente e retrocompatível: o payload
 * que já chegar plano vence o aninhado, então rodar duas vezes não muda nada e
 * um ERP que já fale Focus atravessa intacto.
 */
function definir(destino: Record<string, unknown>, campo: string, valor: unknown): void {
  if (vazio(valor)) return
  if (!vazio(destino[campo])) return
  destino[campo] = valor
}

/** Achata um grupo (emitente/destinatário/transportador) e o endereço dele. */
function achatarGrupo(
  destino: Record<string, unknown>,
  grupo: unknown,
  mapa: Record<string, string>,
  sufixo: string,
): void {
  if (!grupo || typeof grupo !== 'object' || Array.isArray(grupo)) return

  for (const [chave, valor] of Object.entries(grupo as Record<string, unknown>)) {
    /**
     * O endereço do transportador é uma STRING no payload do ERP (a Focus quer
     * `endereco_transportador` como logradouro em texto), enquanto no emitente e
     * no destinatário é um OBJETO. Por isso o desvio testa o tipo, e não só o
     * nome do campo: testar só o nome mandaria a string do transportador para
     * dentro do laço de endereço e ela sumiria.
     */
    if (chave === 'endereco' && valor && typeof valor === 'object' && !Array.isArray(valor)) {
      for (const [chaveEnd, valorEnd] of Object.entries(valor as Record<string, unknown>)) {
        const alvo = MAPA_ENDERECO[chaveEnd]
        if (alvo) definir(destino, `${alvo}_${sufixo}`, valorEnd)
      }
      continue
    }

    const alvo = mapa[chave]
    if (alvo) definir(destino, alvo, valor)
  }
}

/**
 * `data_emissao` no formato que a Focus espera: ISO 8601 COM fuso.
 *
 * É campo obrigatório da Focus e o ERP nunca o manda — ele grava a data no
 * banco dele e não no payload. Preenchemos aqui, no horário de São Paulo, e não
 * em UTC: a data de emissão é o que a SEFAZ carimba no documento, e a nota
 * emitida às 22h de São Paulo sairia com a data do dia seguinte se fosse UTC.
 *
 * O offset é fixo em -03:00 porque o Brasil não tem mais horário de verão desde
 * 2019. Se voltar, é aqui que muda.
 */
function dataEmissaoSaoPaulo(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year:  'numeric', month:  '2-digit', day:    '2-digit',
    hour:  '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(agora).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value
    return acc
  }, {})

  // `hour12: false` devolve "24" à meia-noite em algumas versões do ICU.
  const hora = partes.hour === '24' ? '00' : partes.hour

  return `${partes.year}-${partes.month}-${partes.day}T${hora}:${partes.minute}:${partes.second}-03:00`
}

/**
 * Traduz o payload do ERP para o formato plano da Focus.
 *
 * Não muda o objeto recebido: o chamador ainda precisa do original para log e
 * para a trilha de suporte.
 */
export function traduzirPayloadParaFocus(payload: any, agora: Date = new Date()): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload

  const { emitente, destinatario, transportador, totais, ...raiz } = payload as Record<string, unknown>
  const saida: Record<string, unknown> = { ...raiz }

  /**
   * Os totais sobem inteiros, sem tabela de tradução.
   *
   * Os nomes que o ERP usa dentro de `totais{}` — `valor_produtos`,
   * `icms_base_calculo`, `valor_total` — JÁ SÃO os da Focus; o que estava
   * errado era só o nível. Uma tabela aqui seria uma lista para desatualizar
   * toda vez que a SEFAZ criar um total novo.
   */
  if (totais && typeof totais === 'object' && !Array.isArray(totais)) {
    for (const [chave, valor] of Object.entries(totais as Record<string, unknown>)) {
      definir(saida, chave, valor)
    }
  }

  achatarGrupo(saida, emitente,      MAPA_EMITENTE,      'emitente')
  achatarGrupo(saida, destinatario,  MAPA_DESTINATARIO,  'destinatario')
  achatarGrupo(saida, transportador, MAPA_TRANSPORTADOR, 'transportador')

  /**
   * Os itens já falam Focus — `numero_item`, `cfop`, `valor_bruto`,
   * `icms_situacao_tributaria` e os vinte campos de tributo têm exatamente o
   * mesmo nome dos dois lados. A ÚNICA exceção é o NCM: o ERP chama de `ncm`, a
   * Focus de `codigo_ncm`. Um campo, e sem ele a nota não é autorizada.
   */
  if (Array.isArray(saida.items)) {
    saida.items = (saida.items as unknown[]).map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const { ncm, ...resto } = item as Record<string, unknown>
      if (vazio(ncm) || !vazio(resto.codigo_ncm)) return item
      return { ...resto, codigo_ncm: ncm }
    })
  }

  if (vazio(saida.data_emissao)) {
    saida.data_emissao = dataEmissaoSaoPaulo(agora)
  }

  return saida
}
