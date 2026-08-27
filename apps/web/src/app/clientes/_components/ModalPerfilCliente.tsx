'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  X, Pencil, PowerOff, AlertCircle,
  Monitor, CreditCard, Loader2, Unlock, Lock, Trash2,
  KeyRound, Copy, ExternalLink, RefreshCw, History, AlertTriangle, Save, FileText, Plus, Boxes
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Historico = {
  id:             string
  tipo:           string
  observacao:     string | null
  dataVencimento: string | null
  criadoEm:       string
}

type Licenca = {
  id:              string
  nomeDispositivo: string | null
  status:          string
  isTrial:         boolean
  plano:           { nome: string; limiteUsuario: number | null }
  dataVencimento:  string | null
  usuariosExtras:  number
  totalUsuarios:   number
  ultimoHeartbeat: string | null
  chaveAtivacao:   string
  historico:       Historico[]
}

export type ClienteCompleto = {
  id:        string
  email:     string
  usuarioId: string
  criadoEm:  string
  pf:        { nomeCompleto: string; cpf: string; telefone?: string | null } | null
  pj:        { razaoSocial: string; cnpj: string; nomeFantasia?: string | null; inscricaoEstadual?: string | null; responsavel?: string | null } | null
  enderecos: {
    id:          string
    cep:         string
    logradouro:  string
    numero:      string
    complemento: string | null
    bairro:      string
    cidade:      string
    estado:      string
  }[]
  configuracaoFiscal?: {
    id:                    string
    cnpj:                  string
    razaoSocial:           string
    inscricaoEstadual?:    string | null
    ambiente:              number
    focusEmpresaId?:       string | null
    // O token em si não trafega mais: a API devolve só se ele existe.
    tokenConfigurado?:     boolean
    certificadoNome?:      string | null
    certificadoVencimento?:string | null
    certificadoStatus:     string
  } | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  ATIVA:      { label: 'Ativa',      cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  BLOQUEADA:  { label: 'Bloqueada',  cls: 'text-orange-400  bg-orange-500/10  border-orange-500/20' },
  SUSPENSA:   { label: 'Suspensa',   cls: 'text-yellow-400  bg-yellow-500/10  border-yellow-500/20' },
  VENCIDA:    { label: 'Vencida',    cls: 'text-red-400     bg-red-500/10     border-red-500/20'    },
  AGUARDANDO: { label: 'Aguardando', cls: 'text-slate-400   bg-slate-500/10   border-slate-500/20'  },
}

const HISTORICO_CONFIG: Record<string, { label: string; cls: string }> = {
  TRIAL:        { label: 'Trial',     cls: 'text-purple-400  bg-purple-500/10'  },
  RENOVACAO:    { label: 'Renovação', cls: 'text-blue-400    bg-blue-500/10'    },
  BLOQUEIO:     { label: 'Bloqueio',  cls: 'text-orange-400  bg-orange-500/10'  },
  DESBLOQUEIO:  { label: 'Desbloq.', cls: 'text-emerald-400 bg-emerald-500/10' },
  ATIVACAO:     { label: 'Ativação',  cls: 'text-teal-400    bg-teal-500/10'    },
  CANCELAMENTO: { label: 'Cancelado', cls: 'text-red-400     bg-red-500/10'     },
}

const PERIODOS = [
  { meses: 1,  label: '1 mês',    sub: 'Mensal'     },
  { meses: 3,  label: '3 meses',  sub: 'Trimestral' },
  { meses: 12, label: '12 meses', sub: 'Anual'       },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatData(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

function tempoRelativo(iso: string | null | undefined) {
  if (!iso) return 'Nunca'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return 'Agora'
  const m = Math.floor(s / 60)
  if (m < 60)  return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24)  return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function formatCpf(v: string)  { return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') }
function formatCnpj(v: string) { return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') }

const PALETA = [
  'bg-blue-600', 'bg-emerald-600', 'bg-purple-600',
  'bg-orange-500', 'bg-pink-600', 'bg-cyan-600',
  'bg-indigo-600', 'bg-rose-600', 'bg-teal-600',
]
function corAvatar(nome: string) { return PALETA[(nome.charCodeAt(0) || 0) % PALETA.length] }

// ─── LicencaCard ─────────────────────────────────────────────────────────────

type ModuloDoPlano = { identificador: string; nome: string; ativo: boolean; cotaMensal: number | null }
type ModuloExtra = ModuloDoPlano & {
  cortesia:        boolean
  valorCobrado:    string | number | null
  dataContratacao: string
  dataVencimento:  string | null
  observacao:      string | null
  vencido:         boolean
}
type ModulosLicenca = {
  planoNome: string | null
  doPlano:   ModuloDoPlano[]
  extras:    ModuloExtra[]
  catalogo:  { identificador: string; nome: string; descricao: string | null; ativo: boolean; precoMensal: string | number | null }[]
}

/**
 * Módulos de uma licença, separados por origem.
 *
 * A separação entre "vem do plano" e "concedido à parte" é o motivo desta tela
 * existir: o que vem do plano só muda mexendo no plano, e mexer no plano afeta
 * todo mundo que o contratou. Misturar os dois numa lista só levaria o admin a
 * tentar desmarcar aqui uma coisa que não se desmarca aqui.
 */
function PainelModulos({ licencaId }: { licencaId: string }) {
  const [aberto, setAberto]         = useState(false)
  const [dados, setDados]           = useState<ModulosLicenca | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro]             = useState('')
  const [salvando, setSalvando]     = useState(false)

  const [novo, setNovo] = useState({ identificador: '', cortesia: false, dataVencimento: '', cotaMensal: '', valor: '', observacao: '' })

  /**
   * Ao escolher o módulo, sugere o preço avulso cadastrado em Módulos.
   *
   * Sem a sugestão, o valor é digitado de cabeça a cada concessão e vai
   * divergindo da tabela sem ninguém perceber — e é justamente esse campo que
   * responde "quanto esse cliente paga a mais" seis meses depois.
   */
  function escolherModulo(identificador: string) {
    const m = dados?.catalogo.find(c => c.identificador === identificador)
    const sugerido = m?.precoMensal == null ? '' : String(Number(m.precoMensal))
    setNovo(p => ({ ...p, identificador, valor: p.cortesia ? '' : sugerido }))
  }

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const res  = await fetch(`/api/modulo/licenca/${licencaId}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      setDados(json.data)
    } catch {
      setErro('Falha ao carregar os módulos.')
    } finally {
      setCarregando(false)
    }
  }, [licencaId])

  function alternar() {
    const proximo = !aberto
    setAberto(proximo)
    if (proximo && !dados) carregar()
  }

  function mensagemDeErro(json: any, status: number) {
    // O servidor devolve { erro, detalhes: [{campo, mensagem}] } no 400 do zod.
    if (Array.isArray(json?.detalhes) && json.detalhes.length > 0) {
      return json.detalhes.map((d: any) => d.mensagem).join(' ')
    }
    return json?.erro ?? json?.message ?? `Erro ${status}.`
  }

  async function conceder() {
    if (!novo.identificador) { setErro('Escolha um módulo.'); return }
    setSalvando(true); setErro('')
    try {
      const res = await fetch(`/api/modulo/licenca/${licencaId}/extra`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identificador:  novo.identificador,
          cortesia:       novo.cortesia,
          dataVencimento: novo.dataVencimento || null,
          cotaMensal:     novo.cotaMensal.trim() === '' ? null : Math.max(0, parseInt(novo.cotaMensal) || 0),
          // Cortesia nunca manda valor: o servidor recusa os dois juntos, e é a
          // regra certa — cortesia com valor cobrado é contradição.
          valorCobrado:   novo.cortesia || novo.valor.trim() === '' ? null : Math.max(0, Number(novo.valor) || 0),
          observacao:     novo.observacao.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(mensagemDeErro(json, res.status)); return }
      setDados(json.data)
      setNovo({ identificador: '', cortesia: false, dataVencimento: '', cotaMensal: '', valor: '', observacao: '' })
    } catch {
      setErro('Falha ao conceder o módulo.')
    } finally {
      setSalvando(false)
    }
  }

  async function revogar(identificador: string) {
    setSalvando(true); setErro('')
    try {
      const res  = await fetch(`/api/modulo/licenca/${licencaId}/extra/${identificador}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(mensagemDeErro(json, res.status)); return }
      setDados(json.data)
    } catch {
      setErro('Falha ao revogar o módulo.')
    } finally {
      setSalvando(false)
    }
  }

  // Módulos que ainda não vêm do plano nem foram concedidos — só esses fazem
  // sentido no seletor. Oferecer um que o plano já inclui criaria um extra
  // redundante que não muda nada e confunde na próxima leitura da tela.
  const disponiveis = (dados?.catalogo ?? []).filter(m =>
    m.ativo &&
    !dados?.doPlano.some(p => p.identificador === m.identificador) &&
    !dados?.extras.some(e => e.identificador === m.identificador)
  )

  return (
    <div className="mt-2 border-t border-slate-800 pt-2">
      <button
        onClick={alternar}
        className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
      >
        <Boxes size={12} />
        Módulos liberados
      </button>

      {aberto && (
        <div className="mt-2 space-y-2.5">
          {carregando && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Carregando…
            </p>
          )}

          {dados && (
            <>
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Do plano{dados.planoNome ? ` — ${dados.planoNome}` : ''}
                </p>
                {dados.doPlano.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nenhum módulo incluso neste plano.</p>
                ) : dados.doPlano.map(m => (
                  <div key={m.identificador} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-slate-900/40">
                    <Lock size={10} className="text-slate-600 shrink-0" />
                    <span className="text-slate-300">{m.nome}</span>
                    <span className="text-slate-600">
                      {m.cotaMensal == null ? 'sem limite' : `${m.cotaMensal}/mês`}
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-slate-600">
                  Herdados do plano — para mudar, edite o plano em Planos.
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Concedidos a esta licença</p>
                {dados.extras.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nenhum módulo avulso.</p>
                ) : dados.extras.map(e => (
                  <div key={e.identificador} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-slate-800/60">
                    <span className="text-slate-200">{e.nome}</span>
                    {e.cortesia && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-blue-500/15 text-blue-400">CORTESIA</span>
                    )}
                    {e.vencido && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-500/15 text-red-400">VENCIDO</span>
                    )}
                    {!e.cortesia && e.valorCobrado != null && (
                      <span className="text-emerald-400/80">
                        {Number(e.valorCobrado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês
                      </span>
                    )}
                    <span className="text-slate-500">
                      {e.dataVencimento ? `até ${formatData(e.dataVencimento)}` : 'sem prazo'}
                    </span>
                    <button
                      onClick={() => revogar(e.identificador)}
                      disabled={salvando}
                      className="ml-auto text-slate-500 hover:text-red-400 disabled:opacity-50 transition-colors shrink-0"
                      title="Revogar"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>

              {disponiveis.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-slate-800">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Conceder módulo</p>
                  <div className="flex gap-1.5">
                    <select
                      value={novo.identificador}
                      onChange={e => escolherModulo(e.target.value)}
                      className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                    >
                      <option value="">Escolha…</option>
                      {disponiveis.map(m => <option key={m.identificador} value={m.identificador}>{m.nome}</option>)}
                    </select>
                    {!novo.cortesia && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[11px] text-slate-500">R$</span>
                        <input
                          type="number" min={0} step="0.01" value={novo.valor}
                          onChange={e => setNovo(p => ({ ...p, valor: e.target.value }))}
                          placeholder="valor"
                          className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 placeholder-slate-500 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                        />
                      </div>
                    )}
                    <input
                      type="number" min={0} value={novo.cotaMensal}
                      onChange={e => setNovo(p => ({ ...p, cotaMensal: e.target.value }))}
                      placeholder="Cota"
                      className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 placeholder-slate-500 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                    />
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer shrink-0">
                      <input
                        type="checkbox" checked={novo.cortesia}
                        onChange={e => setNovo(p => ({ ...p, cortesia: e.target.checked, valor: '' }))}
                        className="accent-blue-500"
                      />
                      Cortesia
                    </label>
                    <input
                      type="date" value={novo.dataVencimento}
                      onChange={e => setNovo(p => ({ ...p, dataVencimento: e.target.value }))}
                      className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                    />
                    <button
                      onClick={conceder}
                      disabled={salvando}
                      className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold transition-colors shrink-0"
                    >
                      {salvando ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      Conceder
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {novo.cortesia
                      ? 'Cortesia exige data de fim — sem prazo ela vira gratuidade permanente.'
                      : 'Sem data, o módulo acompanha o ciclo da licença.'}
                    {' '}O ERP enxerga a mudança em até 24h, na próxima revalidação.
                  </p>
                </div>
              )}
            </>
          )}

          {erro && (
            <p className="text-[11px] text-red-400 flex items-center gap-1.5">
              <AlertCircle size={11} /> {erro}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

type Consumo = {
  competencia: string
  emitidas:    number
  canceladas:  number
  cotaPlano:   number | null
  cotaExtra:   number
  cota:        number | null
  restantes:   number | null
  ilimitado:   boolean
}

/**
 * Cota fiscal do mês para uma licença.
 *
 * Carrega sob demanda, e não junto com o cliente: a maioria das licenças não
 * emite nota, e disparar uma requisição por card ao abrir o perfil encheria a
 * API de consulta que ninguém pediu.
 */
function PainelCotaFiscal({ licencaId }: { licencaId: string }) {
  const [aberto,    setAberto]    = useState(false)
  const [consumo,   setConsumo]   = useState<Consumo | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro,      setErro]      = useState('')
  const [extras,    setExtras]    = useState('')
  const [motivo,    setMotivo]    = useState('')
  const [concedendo, setConcedendo] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const res  = await fetch(`/api/fiscal/licencas/${licencaId}/consumo`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      setConsumo(json)
    } catch {
      setErro('Falha ao carregar a cota fiscal.')
    } finally {
      setCarregando(false)
    }
  }, [licencaId])

  function alternar() {
    const proximo = !aberto
    setAberto(proximo)
    if (proximo && !consumo) carregar()
  }

  async function conceder() {
    const qtd = parseInt(extras)
    if (!qtd || qtd < 1) { setErro('Informe uma quantidade de pelo menos 1.'); return }
    setConcedendo(true); setErro('')
    try {
      const res = await fetch(`/api/fiscal/licencas/${licencaId}/notas-extras`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ quantidade: qtd, ...(motivo.trim() ? { motivo: motivo.trim() } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      setConsumo(json)
      setExtras(''); setMotivo('')
    } catch {
      setErro('Falha ao conceder notas avulsas.')
    } finally {
      setConcedendo(false)
    }
  }

  return (
    <div className="mt-2 border-t border-slate-800 pt-2">
      <button
        onClick={alternar}
        className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
      >
        <FileText size={12} />
        Cota fiscal do mês
      </button>

      {aberto && (
        <div className="mt-2 space-y-2">
          {carregando && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Carregando…
            </p>
          )}

          {consumo && (
            <>
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="text-slate-500">{consumo.competencia}</span>
                <span className="text-slate-200 font-semibold">
                  {consumo.emitidas} emitida(s)
                </span>
                <span className="text-slate-500">
                  {consumo.ilimitado ? 'de ilimitado' : `de ${consumo.cota}`}
                </span>
                {consumo.canceladas > 0 && (
                  <span className="text-slate-500">· {consumo.canceladas} cancelada(s)</span>
                )}
              </div>

              {!consumo.ilimitado && (
                <p className="text-[10px] text-slate-500">
                  {consumo.cotaPlano} do plano
                  {consumo.cotaExtra > 0 && ` + ${consumo.cotaExtra} avulsa(s)`}
                  {' · '}
                  <span className={consumo.restantes === 0 ? 'text-red-400 font-semibold' : 'text-slate-400'}>
                    {consumo.restantes} restante(s)
                  </span>
                </p>
              )}

              {consumo.ilimitado ? (
                <p className="text-[10px] text-slate-500">
                  O plano não tem teto — não há o que conceder.
                </p>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    type="number" min={1} value={extras}
                    onChange={e => setExtras(e.target.value)}
                    placeholder="Qtd."
                    className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                  />
                  <input
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                    placeholder="Motivo (opcional)"
                    className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 placeholder-slate-500 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                  />
                  <button
                    onClick={conceder}
                    disabled={concedendo}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold transition-colors shrink-0"
                  >
                    {concedendo ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Conceder
                  </button>
                </div>
              )}

              {!consumo.ilimitado && (
                <p className="text-[10px] text-slate-500">
                  Notas avulsas valem só neste mês e somem na virada. Homologação não consome cota.
                </p>
              )}
            </>
          )}

          {erro && (
            <p className="text-[11px] text-red-400 flex items-center gap-1.5">
              <AlertCircle size={11} /> {erro}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function LicencaCard({ licenca: l, onAtualizar }: { licenca: Licenca; onAtualizar: () => void }) {
  const [copiado,          setCopiado]          = useState(false)
  const [mostrarLink,      setMostrarLink]       = useState(false)
  const [gerando,          setGerando]           = useState<number | null>(null)
  const [urlGerada,        setUrlGerada]         = useState<string | null>(null)
  const [copiadoUrl,       setCopiadoUrl]        = useState(false)
  const [erroCob,          setErroCob]           = useState('')
  const [mostrarRenovar,   setMostrarRenovar]    = useState(false)
  const [renovando,        setRenovando]         = useState<number | null>(null)
  const [erroRenovar,      setErroRenovar]       = useState('')
  const [bloqueando,       setBloqueando]        = useState(false)
  const [erroBloq,         setErroBloq]          = useState('')
  const [mostrarHistorico, setMostrarHistorico]  = useState(false)
  const [confirmarExcluir, setConfirmarExcluir]  = useState(false)
  const [excluindo,        setExcluindo]         = useState(false)
  const [erroExcluir,      setErroExcluir]       = useState('')

  const cfg           = STATUS_CONFIG[l.status] ?? STATUS_CONFIG.AGUARDANDO
  const limiteEfetivo = (l.plano.limiteUsuario ?? 0) + l.usuariosExtras

  function fecharPaineis() {
    setMostrarLink(false); setUrlGerada(null); setErroCob('')
    setMostrarRenovar(false); setErroRenovar('')
  }

  function copiarChave() {
    navigator.clipboard.writeText(l.chaveAtivacao)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1500)
  }

  function copiarUrl() {
    if (!urlGerada) return
    navigator.clipboard.writeText(urlGerada)
    setCopiadoUrl(true)
    setTimeout(() => setCopiadoUrl(false), 1500)
  }

  async function toggleBloquear() {
    setBloqueando(true)
    setErroBloq('')
    const endpoint = l.status === 'BLOQUEADA' ? 'reativar' : 'bloquear'
    try {
      const res  = await fetch(`/api/licenca/${l.id}/${endpoint}`, { method: 'PATCH' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErroBloq(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      onAtualizar()
    } catch {
      setErroBloq('Falha na conexão.')
    } finally {
      setBloqueando(false)
    }
  }

  async function excluirLicenca() {
    setExcluindo(true)
    setErroExcluir('')
    try {
      const res  = await fetch(`/api/licenca/${l.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErroExcluir(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      onAtualizar()
    } catch {
      setErroExcluir('Falha na conexão.')
    } finally {
      setExcluindo(false)
      setConfirmarExcluir(false)
    }
  }

  async function gerarLink(meses: number) {
    setGerando(meses)
    setUrlGerada(null)
    setErroCob('')
    try {
      const res  = await fetch('/api/financeiro/gerar-cobranca', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ licencaId: l.id, meses }),
      })
      const json = await res.json()
      if (!res.ok) setErroCob(json.erro ?? json.message ?? 'Erro ao gerar link.')
      else setUrlGerada(json.url)
    } catch {
      setErroCob('Falha na conexão.')
    } finally {
      setGerando(null)
    }
  }

  async function renovarManual(meses: number) {
    setRenovando(meses)
    setErroRenovar('')
    try {
      const res  = await fetch(`/api/licenca/${l.id}/renovar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ meses }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErroRenovar(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      setMostrarRenovar(false)
      onAtualizar()
    } catch {
      setErroRenovar('Falha na conexão.')
    } finally {
      setRenovando(null)
    }
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-3">

      {/* ── Cabeçalho ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor size={14} className="text-slate-400 shrink-0" />
          <span className="text-sm font-medium text-slate-200 truncate">
            {l.nomeDispositivo ?? 'Sem nome'}
          </span>
          {l.isTrial && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 shrink-0">
              TRIAL
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${cfg.cls}`}>
            {cfg.label}
          </span>
          <button
            onClick={toggleBloquear}
            disabled={bloqueando}
            title={l.status === 'BLOQUEADA' ? 'Reativar licença' : 'Bloquear licença'}
            className={`p-1 rounded transition-colors disabled:opacity-40 ${
              l.status === 'BLOQUEADA'
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-slate-500 hover:text-orange-400 hover:bg-orange-500/10'
            }`}
          >
            {bloqueando
              ? <Loader2 size={12} className="animate-spin" />
              : l.status === 'BLOQUEADA' ? <Unlock size={12} /> : <Lock size={12} />
            }
          </button>
          <button
            onClick={() => { setConfirmarExcluir(v => !v); setErroExcluir('') }}
            title="Excluir licença"
            className="p-1 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {erroBloq && <p className="text-xs text-orange-400">{erroBloq}</p>}

      {/* ── Info grid ── */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">Plano</p>
          <p className="text-slate-300">{l.plano.nome}</p>
        </div>
        {l.dataVencimento && (
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide">Vencimento</p>
            <p className="text-slate-300">{formatData(l.dataVencimento)}</p>
          </div>
        )}
        <div>
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">Usuários</p>
          <p className={l.totalUsuarios >= limiteEfetivo && limiteEfetivo > 0 ? 'text-orange-400' : 'text-slate-300'}>
            {l.totalUsuarios}/{limiteEfetivo}
          </p>
        </div>
        <div>
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">Última conexão</p>
          <p className="text-slate-300">{tempoRelativo(l.ultimoHeartbeat)}</p>
        </div>
      </div>

      {/* ── Chave de ativação ── */}
      <div className="flex items-center gap-2 bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-700/40">
        <KeyRound size={11} className="text-slate-500 shrink-0" />
        <span className="font-mono text-xs text-slate-400 flex-1 truncate">{l.chaveAtivacao}</span>
        <button
          onClick={copiarChave}
          title="Copiar chave"
          className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
        >
          {copiado ? <span className="text-[10px] text-emerald-400">Copiado!</span> : <Copy size={12} />}
        </button>
      </div>

      {/* ── Botões de ação ── */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => { fecharPaineis(); setMostrarLink(v => !v) }}
          className={`flex items-center justify-center gap-1.5 text-xs py-1.5 border border-dashed rounded-lg transition-colors ${
            mostrarLink
              ? 'text-blue-400 border-blue-500/40 bg-blue-500/5'
              : 'text-slate-400 hover:text-blue-400 border-slate-700 hover:border-blue-500/40'
          }`}
        >
          <CreditCard size={12} />
          {mostrarLink ? 'Fechar' : 'Gerar link'}
        </button>
        <button
          onClick={() => { fecharPaineis(); setMostrarRenovar(v => !v) }}
          className={`flex items-center justify-center gap-1.5 text-xs py-1.5 border border-dashed rounded-lg transition-colors ${
            mostrarRenovar
              ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/5'
              : 'text-slate-400 hover:text-emerald-400 border-slate-700 hover:border-emerald-500/40'
          }`}
        >
          <RefreshCw size={12} />
          {mostrarRenovar ? 'Fechar' : 'Renovar (admin)'}
        </button>
      </div>

      {/* ── Painel: link de pagamento Stripe ── */}
      {mostrarLink && (
        <div className="space-y-2.5">
          {urlGerada ? (
            <>
              <p className="text-[11px] text-slate-500 text-center">Link gerado — copie e envie ao cliente</p>
              <div className="flex items-center gap-2 bg-slate-900/70 rounded-lg px-3 py-2.5 border border-blue-500/25">
                <ExternalLink size={11} className="text-blue-400 shrink-0" />
                <span className="text-xs text-blue-300 flex-1 truncate">{urlGerada}</span>
                <button onClick={copiarUrl} className="text-slate-400 hover:text-slate-200 shrink-0 transition-colors">
                  {copiadoUrl ? <span className="text-[10px] text-emerald-400">Copiado!</span> : <Copy size={12} />}
                </button>
              </div>
              <button onClick={() => setUrlGerada(null)} className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                Gerar outro período
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 text-center">Selecione o período de renovação</p>
              <div className="grid grid-cols-3 gap-2">
                {PERIODOS.map(({ meses, label, sub }) => (
                  <button
                    key={meses}
                    disabled={gerando !== null}
                    onClick={() => gerarLink(meses)}
                    className="flex flex-col items-center gap-0.5 py-2.5 bg-slate-900/60 hover:bg-blue-600/10 border border-slate-700 hover:border-blue-500/40 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {gerando === meses
                      ? <Loader2 size={13} className="animate-spin text-blue-400" />
                      : <span className="text-xs font-semibold text-slate-200">{label}</span>
                    }
                    <span className="text-[10px] text-slate-500">{sub}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {erroCob && <p className="text-xs text-red-400 text-center">{erroCob}</p>}
        </div>
      )}

      {/* ── Painel: renovação manual (admin, sem cobrança) ── */}
      {mostrarRenovar && (
        <div className="space-y-2.5">
          <p className="text-[11px] text-slate-500 text-center">Renovar sem cobrança — estende o vencimento</p>
          <div className="grid grid-cols-3 gap-2">
            {PERIODOS.map(({ meses, label, sub }) => (
              <button
                key={meses}
                disabled={renovando !== null}
                onClick={() => renovarManual(meses)}
                className="flex flex-col items-center gap-0.5 py-2.5 bg-slate-900/60 hover:bg-emerald-600/10 border border-slate-700 hover:border-emerald-500/40 rounded-lg transition-colors disabled:opacity-50"
              >
                {renovando === meses
                  ? <Loader2 size={13} className="animate-spin text-emerald-400" />
                  : <span className="text-xs font-semibold text-slate-200">{label}</span>
                }
                <span className="text-[10px] text-slate-500">{sub}</span>
              </button>
            ))}
          </div>
          {erroRenovar && <p className="text-xs text-red-400 text-center">{erroRenovar}</p>}
        </div>
      )}

      {/* ── Histórico ── */}
      {l.historico.length > 0 && (
        <button
          onClick={() => setMostrarHistorico(v => !v)}
          className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
        >
          <History size={11} />
          {mostrarHistorico ? 'Ocultar histórico' : `Ver histórico (${l.historico.length})`}
        </button>
      )}

      {mostrarHistorico && (
        <div className="space-y-1.5">
          {l.historico.map(h => {
            const hcfg = HISTORICO_CONFIG[h.tipo] ?? { label: h.tipo, cls: 'text-slate-400 bg-slate-500/10' }
            return (
              <div key={h.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg bg-slate-900/40 border border-slate-700/30">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${hcfg.cls}`}>{hcfg.label}</span>
                <div className="flex-1 min-w-0">
                  {h.observacao    && <p className="text-[11px] text-slate-400 truncate">{h.observacao}</p>}
                  {h.dataVencimento && <p className="text-[10px] text-slate-500">até {formatData(h.dataVencimento)}</p>}
                </div>
                <span className="text-[10px] text-slate-600 shrink-0">{formatData(h.criadoEm)}</span>
              </div>
            )
          })}
        </div>
      )}

      <PainelModulos licencaId={l.id} />
      <PainelCotaFiscal licencaId={l.id} />

      {/* ── Confirmação de exclusão ── */}
      {confirmarExcluir && (
        <div className="bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertTriangle size={12} />
            <span>Tem certeza? Essa ação não pode ser desfeita.</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setConfirmarExcluir(false); setErroExcluir('') }}
              disabled={excluindo}
              className="flex-1 py-1.5 text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={excluirLicenca}
              disabled={excluindo}
              className="flex-1 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              {excluindo ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              {excluindo ? 'Excluindo...' : 'Confirmar'}
            </button>
          </div>
          {erroExcluir && <p className="text-xs text-red-400">{erroExcluir}</p>}
        </div>
      )}
    </div>
  )
}

// ─── ModalPerfilCliente ───────────────────────────────────────────────────────

type Props = {
  clienteId:   string
  onClose:     () => void
  onEditar:    (c: ClienteCompleto) => void
  onDesativar: (c: ClienteCompleto) => void
  onReativar:  () => Promise<void>
}

export default function ModalPerfilCliente({ clienteId, onClose, onEditar, onDesativar }: Props) {
  const [cliente,    setCliente]    = useState<ClienteCompleto | null>(null)
  const [licencas,   setLicencas]   = useState<Licenca[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro,       setErro]       = useState('')

  const [editandoFiscal, setEditandoFiscal] = useState(false)
  const [cnpj, setCnpj] = useState('')
  const [razaoSocial, setRazaoSocial] = useState('')
  const [inscricaoEstadual, setInscricaoEstadual] = useState('')
  const [ambiente, setAmbiente] = useState(2)
  const [focusToken, setFocusToken] = useState('')
  const [salvandoFiscal, setSalvandoFiscal] = useState(false)
  const [erroFiscal, setErroFiscal] = useState('')

  useEffect(() => {
    if (cliente?.configuracaoFiscal) {
      setCnpj(cliente.configuracaoFiscal.cnpj || '')
      setRazaoSocial(cliente.configuracaoFiscal.razaoSocial || '')
      setInscricaoEstadual(cliente.configuracaoFiscal.inscricaoEstadual || '')
      setAmbiente(cliente.configuracaoFiscal.ambiente || 2)
      // Campo de token começa vazio de propósito — vazio significa "mantém o
      // que já está gravado". O valor real nunca chega até aqui.
      setFocusToken('')
    } else if (cliente?.pj) {
      setCnpj(cliente.pj.cnpj || '')
      setRazaoSocial(cliente.pj.razaoSocial || '')
      setInscricaoEstadual(cliente.pj.inscricaoEstadual || '')
    }
  }, [cliente])

  async function salvarFiscal() {
    setSalvandoFiscal(true)
    setErroFiscal('')
    try {
      const res = await fetch(`/api/cliente/${clienteId}/configuracao-fiscal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnpj,
          razaoSocial,
          inscricaoEstadual,
          ambiente,
          // Só vai quando o admin digitou algo. Mandar string vazia faria o
          // servidor entender que é para apagar o token e desligaria a emissão.
          ...(focusToken.trim() ? { focusEmpresaToken: focusToken.trim() } : {}),
        })
      })

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.message || 'Falha ao salvar configuração fiscal.')
      }

      setEditandoFiscal(false)
      await carregar()
    } catch (e: any) {
      setErroFiscal(e.message || 'Falha ao salvar configuração fiscal.')
    } finally {
      setSalvandoFiscal(false)
    }
  }

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const [resC, resL] = await Promise.all([
        fetch(`/api/cliente/${clienteId}`),
        fetch(`/api/licenca/cliente/${clienteId}`),
      ])
      const jsonC = await resC.json()
      const jsonL = await resL.json()
      setCliente(jsonC)
      setLicencas(jsonL.data ?? jsonL ?? [])
    } catch {
      setErro('Falha ao carregar dados do cliente.')
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  useEffect(() => { carregar() }, [carregar])

  const nome = cliente
    ? cliente.pf ? (cliente.pf.nomeCompleto ?? '—') : (cliente.pj?.razaoSocial ?? '—')
    : '—'

  const doc = cliente
    ? cliente.pf ? formatCpf(cliente.pf.cpf ?? '') : formatCnpj(cliente.pj?.cnpj ?? '')
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0 ${corAvatar(nome)}`}>
              {nome[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">{nome}</h2>
              <p className="text-[11px] text-slate-400">{cliente?.email ?? ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {cliente && (
              <>
                <button
                  onClick={() => onEditar(cliente)}
                  title="Editar cliente"
                  className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-600/15 rounded-lg transition-colors"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => onDesativar(cliente)}
                  title="Desativar cliente"
                  className="p-2 text-orange-400 hover:text-orange-300 hover:bg-orange-500/15 rounded-lg transition-colors"
                >
                  <PowerOff size={14} />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">

          {carregando && (
            <div className="flex flex-col items-center gap-2 py-12">
              <Loader2 size={22} className="animate-spin text-blue-400" />
              <p className="text-xs text-slate-500">Carregando dados...</p>
            </div>
          )}

          {!carregando && erro && (
            <div className="flex items-center gap-2 text-red-400 text-sm py-4 justify-center">
              <AlertCircle size={15} />
              <span>{erro}</span>
            </div>
          )}

          {!carregando && cliente && (
            <>
              {/* Info do cliente */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 space-y-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Dados do cliente</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Tipo</p>
                    <span className={`inline-block font-semibold px-1.5 py-0.5 rounded text-[10px] ${
                      cliente.pj ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'
                    }`}>
                      {cliente.pj ? 'Pessoa Jurídica' : 'Pessoa Física'}
                    </span>
                  </div>
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">
                      {cliente.pf ? 'CPF' : 'CNPJ'}
                    </p>
                    <p className="text-slate-300 font-mono">{doc}</p>
                  </div>
                  {cliente.pj && cliente.pj?.nomeFantasia && (
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Nome Fantasia</p>
                      <p className="text-slate-300">{cliente.pj.nomeFantasia}</p>
                    </div>
                  )}
                  {cliente.pj && cliente.pj?.inscricaoEstadual && (
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Inscrição Estadual</p>
                      <p className="text-slate-300">{cliente.pj.inscricaoEstadual}</p>
                    </div>
                  )}
                  {cliente.pj && cliente.pj?.responsavel && (
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Responsável</p>
                      <p className="text-slate-300">{cliente.pj.responsavel}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Cadastrado em</p>
                    <p className="text-slate-300">{formatData(cliente.criadoEm)}</p>
                  </div>
                </div>
              </div>

              {/* Configuração Fiscal */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Configuração Fiscal (Focus NFe)</p>
                  {!editandoFiscal && (
                    <button
                      onClick={() => setEditandoFiscal(true)}
                      className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                    >
                      <Pencil size={11} />
                      {cliente.configuracaoFiscal ? 'Editar' : 'Configurar'}
                    </button>
                  )}
                </div>

                {editandoFiscal ? (
                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Razão Social</label>
                        <input
                          type="text"
                          value={razaoSocial}
                          onChange={e => setRazaoSocial(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 text-xs"
                          placeholder="Ex: Minha Empresa LTDA"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">CNPJ</label>
                        <input
                          type="text"
                          value={cnpj}
                          onChange={e => setCnpj(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 text-xs font-mono"
                          placeholder="Ex: 00.000.000/0000-00"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Inscrição Estadual</label>
                        <input
                          type="text"
                          value={inscricaoEstadual}
                          onChange={e => setInscricaoEstadual(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 text-xs"
                          placeholder="Isento ou Número"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Ambiente</label>
                        <select
                          value={ambiente}
                          onChange={e => setAmbiente(Number(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/40 text-xs"
                        >
                          <option value={2}>Homologação (Testes)</option>
                          <option value={1}>Produção (Real)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Token de Empresa (Focus NFe)</label>
                      <input
                        type="password"
                        value={focusToken}
                        onChange={e => setFocusToken(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 text-xs font-mono"
                        placeholder={cliente?.configuracaoFiscal?.tokenConfigurado ? 'Token já configurado — deixe em branco para manter' : 'Token obtido no painel da Focus'}
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        {cliente?.configuracaoFiscal?.tokenConfigurado
                          ? 'Por segurança o token não é exibido. Preencha apenas para substituí-lo.'
                          : 'Sem o token o cliente não consegue emitir notas.'}
                      </p>
                    </div>

                    {erroFiscal && (
                      <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 flex items-center gap-1.5">
                        <AlertCircle size={12} />
                        <span>{erroFiscal}</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1.5">
                      <button
                        onClick={() => setEditandoFiscal(false)}
                        className="flex-1 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors text-xs font-semibold"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={salvarFiscal}
                        disabled={salvandoFiscal}
                        className="flex-1 py-1.5 text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg transition-colors text-xs font-semibold flex items-center justify-center gap-1.5"
                      >
                        {salvandoFiscal ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                    {cliente.configuracaoFiscal ? (
                      <>
                        <div>
                          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Razão Social Emitente</p>
                          <p className="text-slate-300 font-medium">{cliente.configuracaoFiscal.razaoSocial}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">CNPJ Emitente</p>
                          <p className="text-slate-300 font-mono">{formatCnpj(cliente.configuracaoFiscal.cnpj)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Inscrição Estadual</p>
                          <p className="text-slate-300">{cliente.configuracaoFiscal.inscricaoEstadual || '—'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Ambiente SEFAZ</p>
                          <span className={`inline-block font-semibold px-1.5 py-0.5 rounded text-[10px] ${
                            cliente.configuracaoFiscal.ambiente === 1 ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'
                          }`}>
                            {cliente.configuracaoFiscal.ambiente === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}
                          </span>
                        </div>
                        <div>
                          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Token Focus NFe</p>
                          <p className="text-slate-300 font-mono">
                            {cliente.configuracaoFiscal.tokenConfigurado ? '••••••••••••••••' : 'Não configurado'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Certificado Digital</p>
                          <span className={`inline-block font-semibold px-1.5 py-0.5 rounded text-[10px] ${
                            cliente.configuracaoFiscal.certificadoStatus === 'ATIVO' ? 'bg-emerald-500/15 text-emerald-400'
                            : cliente.configuracaoFiscal.certificadoStatus === 'VENCIDO' ? 'bg-red-500/15 text-red-400'
                            : 'bg-slate-500/15 text-slate-400'
                          }`}>
                            {cliente.configuracaoFiscal.certificadoStatus === 'ATIVO' ? 'CONFIGURADO'
                             : cliente.configuracaoFiscal.certificadoStatus === 'VENCIDO' ? 'EXPIRADO'
                             : 'NÃO ENVIADO'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="col-span-2 text-center py-2 text-slate-500 text-xs">
                        Nenhuma configuração fiscal vinculada a este cliente.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Licenças */}
              <div className="space-y-2.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Licenças ({licencas.length})
                </p>
                {licencas.length === 0 ? (
                  <div className="text-center py-8">
                    <Monitor size={24} className="mx-auto text-slate-700 mb-2" />
                    <p className="text-sm text-slate-500">Nenhuma licença cadastrada.</p>
                  </div>
                ) : (
                  licencas.map(l => (
                    <LicencaCard key={l.id} licenca={l} onAtualizar={carregar} />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
