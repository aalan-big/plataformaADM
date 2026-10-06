/**
 * Emitente do ERP → corpo do cadastro de EMPRESA da Focus (`/v2/empresas`).
 *
 * O ERP manda o mesmo bloco `emitente{}` que vai em toda nota (o que a SEFAZ já
 * autoriza): `razao_social`, `codigo_regime_tributario`, `endereco{cidade, uf…}`.
 * O cadastro de empresas da Focus usa outros nomes, sem sufixo — `nome`,
 * `regime_tributario`, `municipio`. Este arquivo é só essa tradução; o da nota é
 * o `focus-payload.mapper.ts`, e os dois não se misturam porque os vocabulários
 * são diferentes.
 *
 * Nomes conferidos no plano do ERP (docs/fiscal-onboarding-plano.md §2) e na
 * resposta de validação da própria Focus em 06/10/2026 ("Município inválido").
 */

export type EmitenteErp = {
  cnpj?: string
  razao_social?: string
  nome?: string
  nome_fantasia?: string
  inscricao_estadual?: string | null
  inscricao_municipal?: string | null
  codigo_regime_tributario?: number
  endereco?: {
    logradouro?: string
    numero?: string
    complemento?: string
    bairro?: string
    cidade?: string
    municipio?: string
    uf?: string
    cep?: string
  }
}

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

/**
 * O que FALTA para criar a empresa na Focus, em português de tela.
 *
 * Conferido aqui antes de chamar a Focus porque a recusa dela vem com uma
 * mensagem de cada vez ("Município inválido") — o lojista corrigiria um campo,
 * tentaria de novo e descobriria o próximo.
 */
export function camposFaltandoParaCriar(e: EmitenteErp): string[] {
  const end = e.endereco ?? {}
  const faltam: string[] = []
  if (so(e.cnpj).length !== 14) faltam.push('CNPJ')
  if (!texto(e.razao_social ?? e.nome)) faltam.push('razão social')
  if (![1, 2, 3, 4].includes(Number(e.codigo_regime_tributario))) faltam.push('regime tributário')
  if (!texto(end.logradouro)) faltam.push('logradouro')
  if (!texto(end.numero)) faltam.push('número')
  if (!texto(end.bairro)) faltam.push('bairro')
  if (!texto(end.cidade ?? end.municipio)) faltam.push('cidade')
  if (texto(end.uf).length !== 2) faltam.push('UF')
  if (so(end.cep).length !== 8) faltam.push('CEP')
  return faltam
}

/** Corpo para `POST/PUT /v2/empresas`, sem o certificado (quem chama acrescenta). */
export function emitenteParaCadastroFocus(
  e: EmitenteErp,
  contato: { email?: string | null; telefone?: string | null } = {},
): Record<string, unknown> {
  const end = e.endereco ?? {}
  const corpo: Record<string, unknown> = {
    cnpj:                so(e.cnpj),
    nome:                texto(e.razao_social ?? e.nome),
    nome_fantasia:       texto(e.nome_fantasia) || texto(e.razao_social ?? e.nome),
    inscricao_estadual:  texto(e.inscricao_estadual),
    inscricao_municipal: texto(e.inscricao_municipal),
    regime_tributario:   Number(e.codigo_regime_tributario),
    logradouro:          texto(end.logradouro),
    numero:              texto(end.numero),
    complemento:         texto(end.complemento),
    bairro:              texto(end.bairro),
    municipio:           texto(end.cidade ?? end.municipio),
    uf:                  texto(end.uf).toUpperCase(),
    cep:                 so(end.cep),
    email:               texto(contato.email),
    telefone:            so(contato.telefone),
  }

  // Vazio não vai: no PUT, mandar "" apagaria na Focus um dado que estava certo.
  for (const [campo, valor] of Object.entries(corpo)) {
    if (valor === '' || (typeof valor === 'number' && Number.isNaN(valor))) delete corpo[campo]
  }
  return corpo
}
