'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search, Plus, Eye, RefreshCw,
  Cpu, ShieldCheck, ShieldOff, ShieldAlert, ShieldX, Beaker,
  Copy, CheckCheck,
} from 'lucide-react'
import ModalCriarTrial from './_components/ModalCriarTrial'
import ModalGerarChave from './_components/ModalGerarChave'
import ModalDetalhe    from './_components/ModalDetalhe'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Status = 'AGUARDANDO' | 'ATIVA' | 'BLOQUEADA' | 'VENCIDA' | 'SUSPENSA' | 'REVOGADA'

type Licenca = {
  id: string
  isTrial: boolean
  status: Status
  hwid: string | null
  nomeDispositivo: string | null
  chaveAtivacao: string | null
  dataVencimento: string | null
  criadoEm: string
  plano: { nome: string; precoMensal: number } | null
  cliente: {
    id: string
    email: string
    tipo: 'PF' | 'PJ'
    pf: { nomeCompleto: string } | null
    pj: { razaoSocial: string } | null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nomeCliente(l: Licenca) {
  return l.cliente.tipo === 'PF'
    ? (l.cliente.pf?.nomeCompleto ?? l.cliente.email)
    : (l.cliente.pj?.razaoSocial  ?? l.cliente.email)
}

function formatarData(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  const m = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${d.getDate().toString().padStart(2,'0')} ${m[d.getMonth()]} ${d.getFullYear()}`
}

function diasRestantes(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

const STATUS_CFG: Record<Status, { label: string; cor: string; Icone: React.ElementType }> = {
  ATIVA:      { label: 'Ativa',      cor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', Icone: ShieldCheck },
  AGUARDANDO: { label: 'Aguardando', cor: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',   Icone: ShieldAlert },
  BLOQUEADA:  { label: 'Bloqueada',  cor: 'text-red-400 bg-red-500/10 border-red-500/20',             Icone: ShieldOff   },
  VENCIDA:    { label: 'Vencida',    cor: 'text-slate-400 bg-slate-700/30 border-slate-600/30',       Icone: ShieldOff   },
  SUSPENSA:   { label: 'Suspensa',   cor: 'text-orange-400 bg-orange-500/10 border-orange-500/20',    Icone: ShieldX     },
  REVOGADA:   { label: 'Revogada',   cor: 'text-red-500 bg-red-600/10 border-red-600/20',             Icone: ShieldX     },
}

function BadgeStatus({ status }: { status: Status }) {
  const cfg = STATUS_CFG[status]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${cfg.cor}`}>
      <cfg.Icone size={9} />
      {cfg.label}
    </span>
  )
}

function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar(e: React.MouseEvent) {
    e.stopPropagation()
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1800)
  }
  return (
    <button
      onClick={copiar}
      className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
      title="Copiar chave"
    >
      {copiado ? <CheckCheck size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function DispositivosPage() {
  const [licencas, setLicencas] = useState<Licenca[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<string>('')
  const [filtroTrial, setFiltroTrial] = useState<string>('')
  const [modalCriar, setModalCriar]       = useState(false)
  const [licencaRenovar, setLicencaRenovar] = useState<Licenca | null>(null)
  const [licencaDetalhe, setLicencaDetalhe] = useState<string | null>(null)

  const carregar = useCallback(async (q = '', status = '', trial = '') => {
    setCarregando(true)
    try {
      const params = new URLSearchParams()
      if (q)      params.set('q', q)
      if (status) params.set('status', status)
      if (trial)  params.set('isTrial', trial)
      const url = `/api/licenca${params.toString() ? `?${params}` : ''}`
      const res = await fetch(url)
      const json = await res.json()
      setLicencas(json.data ?? [])
    } catch {
      setLicencas([])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => carregar(busca, filtroStatus, filtroTrial), busca ? 400 : 0)
    return () => clearTimeout(t)
  }, [busca, filtroStatus, filtroTrial, carregar])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const total   = licencas.length
  const ativas  = licencas.filter(l => l.status === 'ATIVA').length
  const trials  = licencas.filter(l => l.isTrial).length
  const vencidas = licencas.filter(l => l.status === 'VENCIDA').length

  const STATS = [
    { label: 'Total',    valor: total,    cor: 'text-white',         bg: '' },
    { label: 'Ativas',   valor: ativas,   cor: 'text-emerald-400',   bg: '' },
    { label: 'Trials',   valor: trials,   cor: 'text-yellow-400',    bg: '' },
    { label: 'Vencidas', valor: vencidas, cor: 'text-slate-400',     bg: '' },
  ]

  return (
    <div className="space-y-5">

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-blue-950 border border-slate-800 p-8">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-linear-to-l from-blue-950/60 to-transparent pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-[0.25em] mb-1.5">
              Gestão de Dispositivos
            </p>
            <h1 className="text-3xl font-extrabold text-white uppercase tracking-wide">
              Dispositivos
            </h1>
          </div>

          <div className="flex items-stretch gap-3 shrink-0">
            {STATS.map(s => (
              <div key={s.label} className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-5 py-3 text-center min-w-18">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Cpu size={10} className="text-slate-400" />
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">{s.label}</p>
                </div>
                <p className={`text-2xl font-extrabold ${s.cor}`}>
                  {carregando ? '—' : s.valor}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FILTROS ──────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        {/* busca */}
        <div className="flex-1 min-w-56 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por cliente, dispositivo, e-mail..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
          />
        </div>

        {/* filtro status */}
        <select
          value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          <option value="">Todos os status</option>
          <option value="ATIVA">Ativa</option>
          <option value="AGUARDANDO">Aguardando</option>
          <option value="BLOQUEADA">Bloqueada</option>
          <option value="SUSPENSA">Suspensa</option>
          <option value="REVOGADA">Revogada</option>
          <option value="VENCIDA">Vencida</option>
        </select>

        {/* filtro trial */}
        <select
          value={filtroTrial}
          onChange={e => setFiltroTrial(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          <option value="">Trial + Pago</option>
          <option value="true">Apenas trial</option>
          <option value="false">Apenas pago</option>
        </select>

        <button
          onClick={() => setModalCriar(true)}
          className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors shadow-lg shadow-blue-900/30"
        >
          <Plus size={14} />
          Nova Licença Trial
        </button>
      </div>

      {/* ── TABELA ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Cliente / Dispositivo</th>
                <th className="text-left px-5 py-3 font-semibold">Plano</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
                <th className="text-left px-5 py-3 font-semibold">Vencimento</th>
                <th className="text-left px-5 py-3 font-semibold">Chave</th>
                <th className="text-left px-5 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">

              {carregando && (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-slate-500 text-xs">Carregando licenças...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!carregando && licencas.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2">
                      <Cpu size={28} className="text-slate-700" />
                      <p className="text-slate-500 text-sm">
                        {busca || filtroStatus || filtroTrial
                          ? 'Nenhuma licença encontrada com esses filtros.'
                          : 'Nenhuma licença cadastrada ainda.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {!carregando && licencas.map(l => {
                const nome  = nomeCliente(l)
                const dias  = diasRestantes(l.dataVencimento)
                const pct   = dias !== null && dias > 0 ? Math.min(100, (dias / 365) * 100) : 0

                return (
                  <tr
                    key={l.id}
                    onClick={() => setLicencaDetalhe(l.id)}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                  >
                    {/* Cliente / Dispositivo */}
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-600/20 flex items-center justify-center shrink-0 mt-0.5">
                          <Cpu size={13} className="text-blue-400" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-200 leading-tight text-[13px]">{nome}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {l.nomeDispositivo ?? <span className="italic">Sem nome</span>}
                          </p>
                          {l.isTrial && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-yellow-400 mt-0.5">
                              <Beaker size={9} />
                              TRIAL
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Plano */}
                    <td className="px-5 py-4">
                      <p className="text-slate-300 text-[13px]">{l.plano?.nome ?? '—'}</p>
                      {l.plano && (
                        <p className="text-[11px] text-slate-500">R$ {Number(l.plano.precoMensal).toFixed(2)}/mês</p>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-4">
                      <BadgeStatus status={l.status} />
                    </td>

                    {/* Vencimento + barra */}
                    <td className="px-5 py-4">
                      <p className={`text-[13px] font-medium ${
                        dias === null    ? 'text-slate-500' :
                        dias <= 0        ? 'text-red-400'   :
                        dias <= 7        ? 'text-yellow-400' :
                                           'text-slate-300'
                      }`}>
                        {formatarData(l.dataVencimento)}
                      </p>
                      {dias !== null && (
                        <div className="mt-1 w-24">
                          <div className="w-full bg-slate-700/60 rounded-full h-1">
                            <div
                              className={`h-1 rounded-full ${
                                dias <= 0  ? 'bg-red-500' :
                                dias <= 7  ? 'bg-yellow-500' :
                                             'bg-emerald-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-slate-600 mt-0.5">
                            {dias <= 0 ? 'Vencida' : `${dias}d restantes`}
                          </p>
                        </div>
                      )}
                    </td>

                    {/* Chave */}
                    <td className="px-5 py-4">
                      {l.chaveAtivacao ? (
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[11px] text-emerald-400/80 truncate max-w-28">
                            {l.chaveAtivacao}
                          </span>
                          <BotaoCopiar texto={l.chaveAtivacao} />
                        </div>
                      ) : (
                        <span className="text-slate-600 text-xs italic">—</span>
                      )}
                    </td>

                    {/* Ações */}
                    <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button
                          onClick={() => setLicencaDetalhe(l.id)}
                          title="Ver detalhes"
                          className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => setLicencaRenovar(l)}
                          title="Renovar / Gerar chave"
                          className="p-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-600/15 rounded-lg transition-colors"
                        >
                          <RefreshCw size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!carregando && licencas.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-800">
            <p className="text-xs text-slate-500">
              <span className="text-slate-300 font-medium">{licencas.length}</span>{' '}
              licença{licencas.length !== 1 ? 's' : ''} encontrada{licencas.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>

      {/* ── MODAIS ───────────────────────────────────────────────────────────── */}

      {modalCriar && (
        <ModalCriarTrial
          onClose={() => setModalCriar(false)}
          onSuccess={() => { setModalCriar(false); carregar(busca, filtroStatus, filtroTrial) }}
        />
      )}

      {licencaRenovar && (
        <ModalGerarChave
          licenca={licencaRenovar}
          onClose={() => setLicencaRenovar(null)}
          onSuccess={() => carregar(busca, filtroStatus, filtroTrial)}
        />
      )}

      {licencaDetalhe && (
        <ModalDetalhe
          licencaId={licencaDetalhe}
          onClose={() => setLicencaDetalhe(null)}
          onAtualizar={() => carregar(busca, filtroStatus, filtroTrial)}
        />
      )}
    </div>
  )
}
