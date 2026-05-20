'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  X, Pencil, PowerOff, AlertCircle,
  Monitor, CreditCard, Loader2, Unlock, Lock, Trash2,
  KeyRound, Copy, ExternalLink, RefreshCw, History, AlertTriangle,
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
  tipo:      'PF' | 'PJ'
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
    ? cliente.tipo === 'PF' ? (cliente.pf?.nomeCompleto ?? '—') : (cliente.pj?.razaoSocial ?? '—')
    : '—'

  const doc = cliente
    ? cliente.tipo === 'PF' ? formatCpf(cliente.pf?.cpf ?? '') : formatCnpj(cliente.pj?.cnpj ?? '')
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
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
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

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
                      cliente.tipo === 'PJ' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'
                    }`}>
                      {cliente.tipo === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física'}
                    </span>
                  </div>
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">
                      {cliente.tipo === 'PF' ? 'CPF' : 'CNPJ'}
                    </p>
                    <p className="text-slate-300 font-mono">{doc}</p>
                  </div>
                  {cliente.tipo === 'PJ' && cliente.pj?.nomeFantasia && (
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Nome Fantasia</p>
                      <p className="text-slate-300">{cliente.pj.nomeFantasia}</p>
                    </div>
                  )}
                  {cliente.tipo === 'PJ' && cliente.pj?.inscricaoEstadual && (
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Inscrição Estadual</p>
                      <p className="text-slate-300">{cliente.pj.inscricaoEstadual}</p>
                    </div>
                  )}
                  {cliente.tipo === 'PJ' && cliente.pj?.responsavel && (
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
