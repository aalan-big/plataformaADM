'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  X, Cpu, Key, RefreshCw, Copy, CheckCheck,
  Loader2, AlertCircle, Calendar, Clock,
  ShieldCheck, ShieldOff, ShieldAlert, ShieldX,
  MonitorOff, UserMinus, UserPlus, RotateCcw,
  Ban, Pause, Trash2, Play, Link2, ExternalLink,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import ModalGerarChave from './ModalGerarChave'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Status = 'AGUARDANDO' | 'ATIVA' | 'BLOQUEADA' | 'VENCIDA' | 'SUSPENSA' | 'REVOGADA'

type HistoricoItem = {
  id: string
  tipo: string
  chaveAtivacao: string
  dataVencimento: string | null
  meses: number | null
  observacao: string | null
  criadoEm: string
}

type LicencaDetalhe = {
  id: string
  isTrial: boolean
  status: Status
  hwid: string | null
  nomeDispositivo: string | null
  chaveAtivacao: string | null
  dataVencimento: string | null
  criadoEm: string
  totalUsuarios: number
  usuariosExtras: number
  plano: { id: string; nome: string; precoMensal: number; precoTrimestral: number | null; precoAnual: number | null; limiteUsuario: number; descontoTrimestral: number | null; descontoAnual: number | null } | null
  cliente: {
    id: string
    email: string
    pf: { nomeCompleto: string } | null
    pj: { razaoSocial: string } | null
  }
  historico: HistoricoItem[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nomeCliente(l: LicencaDetalhe) {
  return l.cliente.pf
    ? (l.cliente.pf.nomeCompleto ?? l.cliente.email)
    : (l.cliente.pj?.razaoSocial ?? l.cliente.email)
}

function formatarData(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  const m = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${d.getDate().toString().padStart(2,'0')} ${m[d.getMonth()]} ${d.getFullYear()}`
}

function diasRestantes(dataVencimento: string | null): number | null {
  if (!dataVencimento) return null
  return Math.ceil((new Date(dataVencimento).getTime() - Date.now()) / 86_400_000)
}

// ─── Configs ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { label: string; cor: string; dot: string; Icone: React.ElementType }> = {
  ATIVA:      { label: 'Ativa',      dot: 'bg-emerald-400', cor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', Icone: ShieldCheck },
  AGUARDANDO: { label: 'Aguardando', dot: 'bg-yellow-400',  cor: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',   Icone: ShieldAlert },
  BLOQUEADA:  { label: 'Bloqueada',  dot: 'bg-red-400',     cor: 'text-red-400 bg-red-500/10 border-red-500/30',             Icone: ShieldOff   },
  VENCIDA:    { label: 'Vencida',    dot: 'bg-slate-500',   cor: 'text-slate-400 bg-slate-700/40 border-slate-600/40',       Icone: ShieldOff   },
  SUSPENSA:   { label: 'Suspensa',   dot: 'bg-orange-400',  cor: 'text-orange-400 bg-orange-500/10 border-orange-500/30',    Icone: ShieldX     },
  REVOGADA:   { label: 'Revogada',   dot: 'bg-red-600',     cor: 'text-red-500 bg-red-600/10 border-red-600/30',             Icone: ShieldX     },
}

const HISTORICO_TIPO_CONFIG: Record<string, { label: string; cor: string }> = {
  TRIAL:      { label: 'Trial',       cor: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  RENOVACAO:  { label: 'Renovação',   cor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  BLOQUEIO:   { label: 'Bloqueio',    cor: 'text-red-400 bg-red-500/10 border-red-500/20' },
  SUSPENSAO:  { label: 'Suspensão',   cor: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
  REVOGACAO:  { label: 'Revogação',   cor: 'text-red-500 bg-red-600/10 border-red-600/20' },
  REATIVACAO: { label: 'Reativação',  cor: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function BotaoAcao({
  onClick, disabled, cor, icone: Icone, label, confirmLabel, perigoso,
}: {
  onClick: () => void
  disabled?: boolean
  cor: string
  icone: React.ElementType
  label: string
  confirmLabel?: string
  perigoso?: boolean
}) {
  const [confirmando, setConfirmando] = useState(false)

  function handleClick() {
    if (perigoso && !confirmando) { setConfirmando(true); setTimeout(() => setConfirmando(false), 3000); return }
    onClick()
    setConfirmando(false)
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        confirmando ? 'bg-red-600/25 border-red-500/50 text-red-300 animate-pulse' : cor
      }`}
    >
      <Icone size={11} />
      {confirmando ? (confirmLabel ?? 'Confirmar?') : label}
    </button>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  licencaId: string
  onClose: () => void
  onAtualizar: () => void
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ModalDetalhe({ licencaId, onClose, onAtualizar }: Props) {
  const [licenca, setLicenca] = useState<LicencaDetalhe | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [modalRenovar, setModalRenovar] = useState(false)
  const [acao, setAcao] = useState<string | null>(null)
  const [mostrarAdmin, setMostrarAdmin] = useState(false)
  // Stripe link
  const [mesesStripe, setMesesStripe] = useState(1)
  const [linkStripe, setLinkStripe] = useState('')
  const [linkCopiado, setLinkCopiado] = useState(false)
  const [gerandoLink, setGerandoLink] = useState(false)
  // Delete
  const [deletando, setDeletando] = useState(false)
  const [confirmandoDelete, setConfirmandoDelete] = useState(false)

  const carregar = useCallback(() => {
    setCarregando(true)
    setErro('')
    fetch(`/api/licenca/${licencaId}`)
      .then(r => r.json())
      .then(j => {
        if (j.data) setLicenca(j.data)
        else setErro('Licença não encontrada.')
      })
      .catch(() => setErro('Falha ao carregar dados.'))
      .finally(() => setCarregando(false))
  }, [licencaId])

  useEffect(() => { carregar() }, [carregar])

  async function executarAcao(endpoint: string) {
    setAcao(endpoint)
    setErro('')
    try {
      const res = await fetch(`/api/licenca/${licencaId}/${endpoint}`, { method: 'PATCH' })
      if (!res.ok) {
        const j = await res.json()
        setErro(j.message ?? j.erro ?? 'Erro ao executar ação.')
        return
      }
      carregar()
      onAtualizar()
    } catch {
      setErro('Falha de conexão.')
    } finally {
      setAcao(null)
    }
  }

  async function copiarChave() {
    if (!licenca?.chaveAtivacao) return
    await navigator.clipboard.writeText(licenca.chaveAtivacao)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  async function gerarLinkStripe() {
    if (!licenca) return
    setGerandoLink(true)
    setErro('')
    try {
      const res = await fetch('/api/financeiro/gerar-cobranca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licencaId: licenca.id, meses: mesesStripe }),
      })
      const j = await res.json()
      if (!res.ok) { setErro(j.message ?? j.erro ?? 'Erro ao gerar link.'); return }
      setLinkStripe(j.url)
    } catch {
      setErro('Falha de conexão ao gerar link.')
    } finally {
      setGerandoLink(false)
    }
  }

  async function copiarLink() {
    await navigator.clipboard.writeText(linkStripe)
    setLinkCopiado(true)
    setTimeout(() => setLinkCopiado(false), 2000)
  }

  async function excluirLicenca() {
    if (!confirmandoDelete) {
      setConfirmandoDelete(true)
      setTimeout(() => setConfirmandoDelete(false), 4000)
      return
    }
    setDeletando(true)
    setErro('')
    try {
      const res = await fetch(`/api/licenca/${licencaId}`, { method: 'DELETE' })
      const j = await res.json()
      if (!res.ok) { setErro(j.message ?? j.erro ?? 'Erro ao excluir.'); setDeletando(false); return }
      onAtualizar()
      onClose()
    } catch {
      setErro('Falha de conexão.')
      setDeletando(false)
    }
  }

  const dias = licenca ? diasRestantes(licenca.dataVencimento) : null
  const statusCfg = licenca ? STATUS_CONFIG[licenca.status] : null
  const executando = acao !== null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

        <div className="relative z-10 w-full max-w-2xl bg-[#0f1117] border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

          {/* ── Cabeçalho ───────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
                <Cpu size={15} className="text-slate-400" />
              </div>
              <div>
                {licenca ? (
                  <>
                    <h2 className="text-sm font-semibold text-white leading-tight">
                      {licenca.nomeDispositivo ?? 'Dispositivo sem nome'}
                    </h2>
                    <p className="text-[11px] text-slate-500">{licenca && nomeCliente(licenca)} · {licenca.cliente.email}</p>
                  </>
                ) : (
                  <h2 className="text-sm font-semibold text-white">Licença</h2>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* ── Corpo ───────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {carregando && (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2 size={24} className="animate-spin text-blue-400" />
                <p className="text-slate-500 text-sm">Carregando...</p>
              </div>
            )}

            {erro && (
              <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm">
                <AlertCircle size={15} />
                {erro}
              </div>
            )}

            {licenca && !carregando && (
              <>
                {/* ── Card da licença (hero) ─────────────────────────── */}
                <div className="rounded-xl border border-slate-700/60 overflow-hidden">

                  {/* Topo do card: status + vencimento */}
                  <div className="bg-slate-800/50 px-5 py-3 flex items-center justify-between gap-3 border-b border-slate-700/50">
                    <div className="flex items-center gap-2">
                      {statusCfg && (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${statusCfg.cor}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                          {statusCfg.label}
                        </span>
                      )}
                      {licenca.isTrial && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
                          TRIAL
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <Calendar size={12} />
                      {licenca.dataVencimento ? (
                        <span className={
                          dias === null ? 'text-slate-400' :
                          dias <= 0    ? 'text-red-400 font-semibold' :
                          dias <= 7    ? 'text-yellow-400 font-semibold' :
                                         'text-emerald-400'
                        }>
                          {dias !== null && dias <= 0
                            ? 'Vencida'
                            : `Vence ${formatarData(licenca.dataVencimento)}`}
                          {dias !== null && dias > 0 && (
                            <span className="text-slate-500 font-normal"> · {dias}d restantes</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-600">Sem vencimento</span>
                      )}
                    </div>
                  </div>

                  {/* Chave de ativação */}
                  <div className="bg-slate-900/60 px-5 py-5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <Key size={9} />
                      Chave de Ativação
                    </p>

                    {licenca.chaveAtivacao ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-950 border border-slate-700/60 rounded-lg px-4 py-3 font-mono text-base font-semibold text-emerald-400 tracking-[0.15em] select-all break-all">
                          {licenca.chaveAtivacao}
                        </div>
                        <button
                          onClick={copiarChave}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-3 bg-slate-800 border border-slate-700 hover:border-emerald-600/50 hover:bg-emerald-600/10 rounded-lg text-slate-400 hover:text-emerald-400 transition-colors"
                          title="Copiar chave"
                        >
                          {copiado ? <CheckCheck size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                    ) : (
                      <p className="text-slate-600 text-sm italic">Nenhuma chave gerada.</p>
                    )}
                  </div>

                  {/* Ações rápidas */}
                  <div className="bg-slate-800/30 border-t border-slate-700/50 px-5 py-3 flex items-center gap-2">
                    <button
                      onClick={() => setModalRenovar(true)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      <RefreshCw size={12} />
                      Renovar licença
                    </button>
                    <button
                      onClick={excluirLicenca}
                      disabled={deletando}
                      className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-all disabled:opacity-50 ${
                        confirmandoDelete
                          ? 'bg-red-600/25 border-red-500/50 text-red-300 animate-pulse'
                          : 'text-slate-400 border-slate-700 hover:bg-red-600/10 hover:border-red-500/40 hover:text-red-400'
                      }`}
                      title="Excluir licença"
                    >
                      {deletando ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      {confirmandoDelete ? 'Confirmar exclusão?' : 'Excluir'}
                    </button>
                    <button
                      onClick={() => { carregar(); onAtualizar() }}
                      className="ml-auto p-2 text-slate-600 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                      title="Atualizar"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>

                {/* ── Informações ────────────────────────────────────── */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Plano',          valor: licenca.plano?.nome },
                    { label: 'Preço / mês',    valor: licenca.plano ? `R$ ${Number(licenca.plano.precoMensal).toFixed(2)}` : undefined },
                    { label: 'Dispositivo',    valor: licenca.nomeDispositivo },
                    {
                      label: 'Usuários ativos',
                      valor: licenca.plano
                        ? `${licenca.totalUsuarios ?? 0} / ${(licenca.plano.limiteUsuario ?? 0) + (licenca.usuariosExtras ?? 0)}${(licenca.usuariosExtras ?? 0) > 0 ? ` (+${licenca.usuariosExtras} extra)` : ''}`
                        : undefined,
                    },
                  ].filter(c => c.valor).map(c => (
                    <div key={c.label} className="bg-slate-800/30 border border-slate-700/40 rounded-lg px-4 py-3">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{c.label}</p>
                      <p className="text-sm text-slate-200 font-medium">{c.valor}</p>
                    </div>
                  ))}
                  {licenca.hwid && (
                    <div className="col-span-2 bg-slate-800/30 border border-slate-700/40 rounded-lg px-4 py-3">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">HWID</p>
                      <p className="text-xs text-slate-300 font-mono break-all">{licenca.hwid}</p>
                    </div>
                  )}
                </div>

                {/* ── Controles Administrativos (colapsável) ─────────── */}
                <div className="border border-slate-700/50 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setMostrarAdmin(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3 bg-slate-800/40 hover:bg-slate-800/70 transition-colors"
                  >
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Controles Administrativos</span>
                    {mostrarAdmin ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                  </button>

                  {mostrarAdmin && (
                    <div className="px-5 py-4 space-y-3 border-t border-slate-700/50">
                      <div className="flex flex-wrap gap-2">
                        {licenca.status !== 'BLOQUEADA' && licenca.status !== 'REVOGADA' && (
                          <BotaoAcao onClick={() => executarAcao('bloquear')} disabled={executando}
                            cor="text-red-400 bg-red-500/10 hover:bg-red-500/20 border-red-500/20"
                            icone={Ban} label="Bloquear" confirmLabel="Bloquear mesmo assim?" perigoso />
                        )}
                        {licenca.status !== 'SUSPENSA' && licenca.status !== 'REVOGADA' && (
                          <BotaoAcao onClick={() => executarAcao('suspender')} disabled={executando}
                            cor="text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/20"
                            icone={Pause} label="Suspender" confirmLabel="Suspender mesmo assim?" perigoso />
                        )}
                        {licenca.status !== 'REVOGADA' && (
                          <BotaoAcao onClick={() => executarAcao('revogar')} disabled={executando}
                            cor="text-red-500 bg-red-600/10 hover:bg-red-600/20 border-red-600/20"
                            icone={ShieldX} label="Revogar" confirmLabel="Revogar definitivo?" perigoso />
                        )}
                        {(licenca.status === 'BLOQUEADA' || licenca.status === 'SUSPENSA' || licenca.status === 'REVOGADA' || licenca.status === 'VENCIDA') && (
                          <BotaoAcao onClick={() => executarAcao('reativar')} disabled={executando}
                            cor="text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20"
                            icone={Play} label="Reativar" />
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <BotaoAcao onClick={() => executarAcao('resetar-sessoes')} disabled={executando}
                          cor="text-slate-300 bg-slate-700/40 hover:bg-slate-700/70 border-slate-600/40"
                          icone={RotateCcw} label="Resetar usuários" />
                        <BotaoAcao onClick={() => executarAcao('trocar-dispositivo')} disabled={executando}
                          cor="text-slate-300 bg-slate-700/40 hover:bg-slate-700/70 border-slate-600/40"
                          icone={MonitorOff} label="Trocar dispositivo" />
                        <BotaoAcao onClick={() => executarAcao('adicionar-extra')} disabled={executando}
                          cor="text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/20"
                          icone={UserPlus} label="+1 Extra" />
                        <BotaoAcao onClick={() => executarAcao('remover-extra')} disabled={executando || (licenca.usuariosExtras ?? 0) === 0}
                          cor="text-slate-400 bg-slate-700/40 hover:bg-slate-700/70 border-slate-600/40"
                          icone={UserMinus} label="-1 Extra" />
                      </div>
                      {executando && (
                        <div className="flex items-center gap-2 text-slate-500 text-xs">
                          <Loader2 size={11} className="animate-spin" />
                          Executando...
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Link de Pagamento ──────────────────────────────── */}
                <div className="border border-slate-700/50 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-slate-800/40 border-b border-slate-700/50">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Link de Pagamento</p>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    {/* Campo de link */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Link2 size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                        <input
                          readOnly
                          value={linkStripe}
                          placeholder="O link aparecerá aqui após gerar..."
                          onClick={e => linkStripe && (e.target as HTMLInputElement).select()}
                          className="w-full bg-slate-950 border border-slate-700/60 text-blue-400 placeholder-slate-700 text-[11px] font-mono rounded-lg pl-8 pr-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                        />
                      </div>
                      {linkStripe && (
                        <>
                          <button onClick={copiarLink} title="Copiar link"
                            className="shrink-0 p-2.5 bg-slate-800 border border-slate-700 hover:border-emerald-600/40 hover:bg-emerald-600/10 rounded-lg text-slate-400 hover:text-emerald-400 transition-colors">
                            {linkCopiado ? <CheckCheck size={13} className="text-emerald-400" /> : <Copy size={13} />}
                          </button>
                          <a href={linkStripe} target="_blank" rel="noreferrer" title="Abrir link"
                            className="shrink-0 p-2.5 bg-slate-800 border border-slate-700 hover:border-blue-600/40 hover:bg-blue-600/10 rounded-lg text-slate-400 hover:text-blue-400 transition-colors">
                            <ExternalLink size={13} />
                          </a>
                        </>
                      )}
                    </div>
                    {/* Período + botão */}
                    {(() => {
                      const plano   = licenca.plano
                      const preco   = Number(plano?.precoMensal ?? 0)
                      const descTri = plano?.descontoTrimestral != null ? Number(plano.descontoTrimestral) : 5
                      const descAnu = plano?.descontoAnual      != null ? Number(plano.descontoAnual)      : 10

                      const totalTri = plano?.precoTrimestral != null
                        ? Number(plano.precoTrimestral)
                        : preco * 3 * (1 - descTri / 100)
                      const totalAnu = plano?.precoAnual != null
                        ? Number(plano.precoAnual)
                        : preco * 12 * (1 - descAnu / 100)

                      const descExibidaTri = plano?.precoTrimestral != null && preco > 0
                        ? Math.round((1 - Number(plano.precoTrimestral) / (preco * 3)) * 100)
                        : descTri
                      const descExibidaAnu = plano?.precoAnual != null && preco > 0
                        ? Math.round((1 - Number(plano.precoAnual) / (preco * 12)) * 100)
                        : descAnu

                      const opcoes = [
                        { m: 1,  label: '1 mês',    total: preco,     desc: 0              },
                        { m: 3,  label: '3 meses',  total: totalTri,  desc: descExibidaTri },
                        { m: 12, label: '12 meses', total: totalAnu,  desc: descExibidaAnu },
                      ]
                      return (
                        <div className="flex items-end gap-2">
                          {opcoes.map(({ m, label, total, desc }) => (
                            <button key={m}
                              onClick={() => { setMesesStripe(m); setLinkStripe(''); setLinkCopiado(false) }}
                              className={`flex-1 flex flex-col items-center py-2.5 rounded-lg border transition-all ${
                                mesesStripe === m
                                  ? 'bg-blue-600 border-blue-500 text-white'
                                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                              }`}
                            >
                              <span className="text-[10px] font-semibold">{label}</span>
                              {preco > 0 && (
                                <span className={`text-xs font-bold mt-0.5 ${mesesStripe === m ? 'text-white' : 'text-slate-200'}`}>
                                  R$ {total.toFixed(2).replace('.', ',')}
                                </span>
                              )}
                              {desc > 0 && (
                                <span className={`text-[9px] font-semibold mt-0.5 ${mesesStripe === m ? 'text-blue-200' : 'text-emerald-500'}`}>
                                  -{desc}% off
                                </span>
                              )}
                            </button>
                          ))}
                          <button
                            onClick={gerarLinkStripe}
                            disabled={gerandoLink}
                            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg transition-colors"
                          >
                            {gerandoLink ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                            Gerar
                          </button>
                        </div>
                      )
                    })()}
                    {linkStripe && (
                      <p className="text-[11px] text-slate-600">Copie e envie ao cliente. O link expira após o pagamento.</p>
                    )}
                  </div>
                </div>

                {/* ── Histórico ──────────────────────────────────────── */}
                <div className="border border-slate-700/50 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-slate-800/40 border-b border-slate-700/50 flex items-center gap-2">
                    <Clock size={12} className="text-slate-500" />
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                      Histórico <span className="text-slate-600 normal-case font-normal">({licenca.historico.length})</span>
                    </p>
                  </div>

                  <div className="px-5 py-4">
                    {licenca.historico.length === 0 ? (
                      <p className="text-center text-xs text-slate-600 py-4">Nenhum evento registrado.</p>
                    ) : (
                      <div className="space-y-2">
                        {licenca.historico.map((h, i) => {
                          const tipoCfg = HISTORICO_TIPO_CONFIG[h.tipo] ?? {
                            label: h.tipo,
                            cor: 'text-slate-400 bg-slate-700/30 border-slate-600/30',
                          }
                          return (
                            <div key={h.id} className="flex items-start gap-3">
                              <div className="flex flex-col items-center shrink-0 mt-1.5">
                                <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                                {i < licenca.historico.length - 1 && <div className="w-px h-full min-h-8 bg-slate-800 mt-1" />}
                              </div>
                              <div className="flex-1 bg-slate-800/20 border border-slate-700/30 rounded-lg px-3.5 py-2.5">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${tipoCfg.cor}`}>
                                    {tipoCfg.label}
                                  </span>
                                  <span className="text-[11px] text-slate-600 ml-auto">{formatarData(h.criadoEm)}</span>
                                </div>
                                <p className="font-mono text-xs text-emerald-400/70">{h.chaveAtivacao}</p>
                                {h.meses !== null && (
                                  <p className="text-[11px] text-slate-500 mt-0.5">
                                    +{h.meses} {h.meses === 1 ? 'mês' : 'meses'}
                                    {h.dataVencimento ? ` · vence ${formatarData(h.dataVencimento)}` : ''}
                                  </p>
                                )}
                                {h.observacao && (
                                  <p className="text-[11px] text-slate-600 mt-0.5 italic">{h.observacao}</p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Rodapé ──────────────────────────────────────────────────── */}
          <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>

      {modalRenovar && licenca && (
        <ModalGerarChave
          licenca={licenca}
          onClose={() => setModalRenovar(false)}
          onSuccess={() => { carregar(); onAtualizar() }}
        />
      )}
    </>
  )
}
