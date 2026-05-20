'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, DollarSign, CreditCard,
  AlertTriangle, Search, CheckCircle2, Loader2,
  AlertCircle, RefreshCw, X, Calendar, ChevronDown,
} from 'lucide-react'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

type Resumo = {
  mesAtual:    { total: number; quantidade: number }
  mesAnterior: { total: number; quantidade: number }
  crescimento: number | null
}

type Pagamento = {
  id:        string
  valor:     number | string
  meses:     number
  status:    string
  gateway:   string
  observacao: string | null
  criadoEm:  string
  cliente: {
    email: string
    tipo:  string
    pf:    { nomeCompleto: string } | null
    pj:    { razaoSocial: string }  | null
  }
  licenca: {
    nomeDispositivo: string | null
    plano:           { nome: string } | null
  } | null
}

type Inadimplente = {
  id:             string
  status:         string
  dataVencimento: string | null
  isTrial:        boolean
  cliente: {
    email: string
    tipo:  string
    pf:    { nomeCompleto: string } | null
    pj:    { razaoSocial: string }  | null
  }
  plano: { nome: string; precoMensal: number | string } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nomeCliente(c: { tipo: string; pf: { nomeCompleto: string } | null; pj: { razaoSocial: string } | null; email: string }) {
  return c.tipo === 'PF' ? (c.pf?.nomeCompleto ?? c.email) : (c.pj?.razaoSocial ?? c.email)
}

function formatarReais(v: number | string) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(iso: string) {
  const d = new Date(iso)
  const m = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${d.getDate().toString().padStart(2,'0')} ${m[d.getMonth()]} ${d.getFullYear()}`
}

function diasRestantes(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

// ─── Modal Confirmar Pagamento ─────────────────────────────────────────────────

function ModalConfirmarPagamento({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [busca,       setBusca]       = useState('')
  const [licencas,    setLicencas]    = useState<{ id: string; nomeDispositivo: string | null; cliente: { pf: {nomeCompleto:string}|null; pj:{razaoSocial:string}|null; email:string; tipo:string }; plano:{nome:string;precoMensal:number|string}|null }[]>([])
  const [buscando,    setBuscando]    = useState(false)
  const [selecionada, setSelecionada] = useState<typeof licencas[0] | null>(null)
  const [meses,       setMeses]       = useState(1)
  const [valor,       setValor]       = useState('')
  const [obs,         setObs]         = useState('')
  const [enviando,    setEnviando]    = useState(false)
  const [erro,        setErro]        = useState('')
  const [sucesso,     setSucesso]     = useState<{ chave: string; vencimento: string } | null>(null)

  useEffect(() => {
    if (!busca.trim()) { setLicencas([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const res  = await fetch(`/api/licenca?q=${encodeURIComponent(busca)}`)
        const json = await res.json()
        setLicencas(json.data ?? [])
      } finally { setBuscando(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [busca])

  async function confirmar() {
    if (!selecionada) return
    setEnviando(true); setErro('')
    try {
      const res  = await fetch('/api/financeiro/confirmar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ licencaId: selecionada.id, meses, valor: Number(valor), observacao: obs || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Erro ao confirmar.')
      setSucesso({ chave: json.data.chaveAtivacao, vencimento: json.data.dataVencimento })
      onSuccess()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally { setEnviando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="font-bold text-white">Confirmar Pagamento Manual</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors"><X size={16}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {sucesso ? (
            <div className="text-center space-y-4 py-4">
              <CheckCircle2 size={40} className="text-emerald-400 mx-auto" />
              <p className="font-semibold text-white">Pagamento confirmado!</p>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">Chave de Ativação</p>
                <p className="font-mono text-emerald-400 text-lg tracking-wider">{sucesso.chave}</p>
                <p className="text-xs text-slate-400">Vence em {formatarData(sucesso.vencimento)}</p>
              </div>
              <p className="text-xs text-slate-500">A chave foi enviada por e-mail ao cliente.</p>
            </div>
          ) : (
            <>
              {!selecionada ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Buscar Licença / Cliente</label>
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      autoFocus
                      type="text" value={busca} onChange={e => setBusca(e.target.value)}
                      placeholder="Nome, e-mail ou dispositivo..."
                      className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    {buscando && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-500" />}
                  </div>
                  {licencas.length > 0 && (
                    <div className="border border-slate-700 rounded-xl overflow-hidden mt-1">
                      {licencas.slice(0, 6).map(l => (
                        <button key={l.id} onClick={() => { setSelecionada(l); setValor(l.plano ? String(Number(l.plano.precoMensal) * meses) : '') }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800 transition-colors border-b border-slate-800 last:border-0 text-left">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-200 truncate">{nomeCliente(l.cliente)}</p>
                            <p className="text-xs text-slate-500 truncate">{l.nomeDispositivo ?? 'Sem nome'} · {l.plano?.nome ?? '—'}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{nomeCliente(selecionada.cliente)}</p>
                      <p className="text-xs text-slate-400">{selecionada.nomeDispositivo ?? 'Sem nome'} · {selecionada.plano?.nome ?? '—'}</p>
                    </div>
                    <button onClick={() => setSelecionada(null)} className="text-slate-500 hover:text-slate-300 text-xs">Trocar</button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Meses</label>
                      <select value={meses} onChange={e => { const m = Number(e.target.value); setMeses(m); if (selecionada.plano) setValor(String((Number(selecionada.plano.precoMensal) * m).toFixed(2))) }}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                        {[1,2,3,6,12].map(m => <option key={m} value={m}>{m} {m === 1 ? 'mês' : 'meses'}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Valor (R$)</label>
                      <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Observação (opcional)</label>
                    <input type="text" value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex: PIX recebido, Boleto pago..."
                      className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                  </div>

                  {erro && (
                    <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-sm">
                      <AlertCircle size={14} className="shrink-0"/>{erro}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {!sucesso && selecionada && (
          <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">Cancelar</button>
            <button onClick={confirmar} disabled={enviando || !valor}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors">
              {enviando ? <Loader2 size={12} className="animate-spin"/> : <CheckCircle2 size={12}/>}
              Confirmar pagamento
            </button>
          </div>
        )}
        {sucesso && (
          <div className="px-6 py-4 border-t border-slate-800 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors">Fechar</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Página Principal ──────────────────────────────────────────────────────────

export default function FinanceiroPage() {
  const agora = new Date()
  const [aba,          setAba]          = useState<'pagamentos' | 'inadimplentes'>('pagamentos')
  const [resumo,       setResumo]       = useState<Resumo | null>(null)
  const [pagamentos,   setPagamentos]   = useState<Pagamento[]>([])
  const [inadimplentes, setInadimplentes] = useState<Inadimplente[]>([])
  const [carregando,   setCarregando]   = useState(true)
  const [ano,          setAno]          = useState(String(agora.getFullYear()))
  const [mes,          setMes]          = useState(String(agora.getMonth() + 1))
  const [gateway,      setGateway]      = useState('')
  const [busca,        setBusca]        = useState('')
  const [modalPgto,    setModalPgto]    = useState(false)

  const carregarResumo = useCallback(async () => {
    const res  = await fetch('/api/financeiro/resumo')
    const json = await res.json()
    if (json.data) setResumo(json.data)
  }, [])

  const carregarPagamentos = useCallback(async () => {
    setCarregando(true)
    const p = new URLSearchParams()
    if (ano)     p.set('ano',     ano)
    if (mes)     p.set('mes',     mes)
    if (gateway) p.set('gateway', gateway)
    if (busca)   p.set('q',       busca)
    const res  = await fetch(`/api/financeiro/pagamentos?${p}`)
    const json = await res.json()
    setPagamentos(json.data ?? [])
    setCarregando(false)
  }, [ano, mes, gateway, busca])

  const carregarInadimplentes = useCallback(async () => {
    setCarregando(true)
    const res  = await fetch('/api/financeiro/inadimplentes?dias=30')
    const json = await res.json()
    setInadimplentes(json.data ?? [])
    setCarregando(false)
  }, [])

  useEffect(() => { carregarResumo() }, [carregarResumo])

  useEffect(() => {
    if (aba === 'pagamentos')    carregarPagamentos()
    if (aba === 'inadimplentes') carregarInadimplentes()
  }, [aba, carregarPagamentos, carregarInadimplentes])

  useEffect(() => {
    if (aba !== 'pagamentos') return
    const t = setTimeout(carregarPagamentos, busca ? 400 : 0)
    return () => clearTimeout(t)
  }, [busca, ano, mes, gateway, carregarPagamentos, aba])

  const anos = Array.from({ length: 3 }, (_, i) => String(agora.getFullYear() - i))

  return (
    <div className="space-y-5">

      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-emerald-950 border border-slate-800 p-8">
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-linear-to-l from-emerald-950/60 to-transparent pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-[0.25em] mb-1.5">Gestão Financeira</p>
            <h1 className="text-3xl font-extrabold text-white uppercase tracking-wide">Financeiro</h1>
          </div>

          {/* Cards de resumo */}
          <div className="flex items-stretch gap-3 shrink-0 flex-wrap">
            {[
              {
                label: 'Mês Atual',
                valor: resumo ? formatarReais(resumo.mesAtual.total) : '—',
                sub:   resumo ? `${resumo.mesAtual.quantidade} pagamentos` : '',
                cor:   'text-emerald-400',
                Icone: DollarSign,
              },
              {
                label: 'Mês Anterior',
                valor: resumo ? formatarReais(resumo.mesAnterior.total) : '—',
                sub:   resumo ? `${resumo.mesAnterior.quantidade} pagamentos` : '',
                cor:   'text-slate-300',
                Icone: Calendar,
              },
              {
                label: 'Crescimento',
                valor: resumo?.crescimento !== null && resumo?.crescimento !== undefined
                  ? `${resumo.crescimento > 0 ? '+' : ''}${resumo.crescimento}%`
                  : '—',
                sub:   'vs mês anterior',
                cor:   resumo?.crescimento !== null && resumo !== null
                  ? (resumo.crescimento! >= 0 ? 'text-emerald-400' : 'text-red-400')
                  : 'text-slate-400',
                Icone: resumo?.crescimento !== null && resumo !== null && resumo.crescimento! >= 0 ? TrendingUp : TrendingDown,
              },
            ].map(s => (
              <div key={s.label} className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-5 py-3 min-w-28">
                <div className="flex items-center gap-1 mb-1">
                  <s.Icone size={10} className="text-slate-400" />
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">{s.label}</p>
                </div>
                <p className={`text-xl font-extrabold ${s.cor}`}>{s.valor}</p>
                {s.sub && <p className="text-[10px] text-slate-500 mt-0.5">{s.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ABAS */}
      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
        {([['pagamentos', 'Pagamentos', CreditCard], ['inadimplentes', 'Em Risco', AlertTriangle]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              aba === id ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}>
            <Icon size={14} />
            {label}
            {id === 'inadimplentes' && inadimplentes.length > 0 && (
              <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded-full font-bold">
                {inadimplentes.length}
              </span>
            )}
          </button>
        ))}

        <div className="ml-auto pl-4">
          <button onClick={() => setModalPgto(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-emerald-900/30">
            <CheckCircle2 size={14} />
            Confirmar Pagamento
          </button>
        </div>
      </div>

      {/* ABA PAGAMENTOS */}
      {aba === 'pagamentos' && (
        <>
          {/* Filtros */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap gap-3 items-center">
            <div className="flex-1 min-w-48 relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="text" placeholder="Buscar por cliente..." value={busca} onChange={e => setBusca(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            </div>
            <select value={mes} onChange={e => setMes(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              <option value="">Todos os meses</option>
              {MESES.map((m, i) => <option key={i} value={String(i+1)}>{m}</option>)}
            </select>
            <select value={ano} onChange={e => setAno(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              {anos.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={gateway} onChange={e => setGateway(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              <option value="">Todos os gateways</option>
              <option value="MANUAL">Manual</option>
              <option value="ASAAS">Asaas</option>
            </select>
          </div>

          {/* Tabela de pagamentos */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-semibold">Cliente</th>
                  <th className="text-left px-5 py-3 font-semibold">Dispositivo / Plano</th>
                  <th className="text-left px-5 py-3 font-semibold">Período</th>
                  <th className="text-left px-5 py-3 font-semibold">Gateway</th>
                  <th className="text-right px-5 py-3 font-semibold">Valor</th>
                  <th className="text-left px-5 py-3 font-semibold">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {carregando && (
                  <tr><td colSpan={6} className="text-center py-14">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
                      <span className="text-slate-500 text-xs">Carregando pagamentos...</span>
                    </div>
                  </td></tr>
                )}
                {!carregando && pagamentos.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-14">
                    <DollarSign size={28} className="text-slate-700 mx-auto mb-2"/>
                    <p className="text-slate-500 text-sm">Nenhum pagamento encontrado.</p>
                  </td></tr>
                )}
                {!carregando && pagamentos.map(p => (
                  <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-200 text-[13px]">{nomeCliente(p.cliente)}</p>
                      <p className="text-[11px] text-slate-500">{p.cliente.email}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-slate-300 text-[13px]">{p.licenca?.nomeDispositivo ?? '—'}</p>
                      <p className="text-[11px] text-slate-500">{p.licenca?.plano?.nome ?? '—'}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-slate-300 text-[13px]">{p.meses} {p.meses === 1 ? 'mês' : 'meses'}</p>
                      {p.observacao && <p className="text-[11px] text-slate-500 truncate max-w-32">{p.observacao}</p>}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        p.gateway === 'ASAAS'
                          ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
                          : 'text-slate-400 bg-slate-700/30 border-slate-600/30'
                      }`}>
                        {p.gateway}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <p className="text-emerald-400 font-bold text-[13px]">{formatarReais(p.valor)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-slate-400 text-[13px]">{formatarData(p.criadoEm)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!carregando && pagamentos.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  <span className="text-slate-300 font-medium">{pagamentos.length}</span> pagamento{pagamentos.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-emerald-400 font-semibold">
                  Total: {formatarReais(pagamentos.reduce((s, p) => s + Number(p.valor), 0))}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ABA INADIMPLENTES */}
      {aba === 'inadimplentes' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
            <AlertTriangle size={13} className="text-yellow-400" />
            <p className="text-xs font-semibold text-slate-300">Licenças vencidas ou vencendo nos próximos 30 dias</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Cliente</th>
                <th className="text-left px-5 py-3 font-semibold">Plano</th>
                <th className="text-left px-5 py-3 font-semibold">Situação</th>
                <th className="text-left px-5 py-3 font-semibold">Vencimento</th>
                <th className="text-left px-5 py-3 font-semibold">Tipo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {carregando && (
                <tr><td colSpan={5} className="text-center py-14">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-6 h-6 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"/>
                    <span className="text-slate-500 text-xs">Carregando...</span>
                  </div>
                </td></tr>
              )}
              {!carregando && inadimplentes.length === 0 && (
                <tr><td colSpan={5} className="text-center py-14">
                  <CheckCircle2 size={28} className="text-emerald-600 mx-auto mb-2"/>
                  <p className="text-slate-500 text-sm">Nenhuma licença em risco. Tudo em dia!</p>
                </td></tr>
              )}
              {!carregando && inadimplentes.map(l => {
                const dias = diasRestantes(l.dataVencimento)
                const vencida = l.status === 'VENCIDA' || (dias !== null && dias <= 0)
                return (
                  <tr key={l.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-200 text-[13px]">{nomeCliente(l.cliente)}</p>
                      <p className="text-[11px] text-slate-500">{l.cliente.email}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-slate-300 text-[13px]">{l.plano?.nome ?? '—'}</p>
                      {l.plano && <p className="text-[11px] text-slate-500">{formatarReais(l.plano.precoMensal)}/mês</p>}
                    </td>
                    <td className="px-5 py-4">
                      {vencida ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-red-400 bg-red-500/10 border-red-500/20">Vencida</span>
                      ) : dias !== null && dias <= 7 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-yellow-400 bg-yellow-500/10 border-yellow-500/20">Crítico</span>
                      ) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-orange-400 bg-orange-500/10 border-orange-500/20">Em risco</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <p className={`text-[13px] font-medium ${vencida ? 'text-red-400' : dias !== null && dias <= 7 ? 'text-yellow-400' : 'text-orange-400'}`}>
                        {l.dataVencimento ? formatarData(l.dataVencimento) : '—'}
                      </p>
                      {dias !== null && (
                        <p className="text-[11px] text-slate-500">
                          {vencida ? `Há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''}` : `${dias} dia${dias !== 1 ? 's' : ''}`}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        l.isTrial
                          ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
                          : 'text-slate-400 bg-slate-700/30 border-slate-600/30'
                      }`}>
                        {l.isTrial ? 'TRIAL' : 'PAGO'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalPgto && (
        <ModalConfirmarPagamento
          onClose={() => setModalPgto(false)}
          onSuccess={() => { carregarResumo(); if (aba === 'pagamentos') carregarPagamentos() }}
        />
      )}
    </div>
  )
}
