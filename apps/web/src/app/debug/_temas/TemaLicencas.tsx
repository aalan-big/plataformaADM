'use client'

import React, { useState, useEffect, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'

interface ApiResponse {
  ok: boolean; status?: number; statusText?: string; payload?: unknown; error?: string
}

async function api(url: string, options?: RequestInit): Promise<ApiResponse> {
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options })
    const data = await res.json()
    return { status: res.status, statusText: res.statusText, ok: res.ok, payload: data }
  } catch (err) {
    return { error: 'Falha na conexão', ok: false, payload: err instanceof Error ? err.message : String(err) }
  }
}

const ic = 'w-full bg-[#0f172a] border border-slate-600 rounded p-2 outline-none transition text-sm'
const lc = 'block text-xs uppercase font-bold text-slate-500 mb-1'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={lc}>{label}</label>{children}</div>
}

function RotaBadge({ metodo, rota }: { metodo: string; rota: string }) {
  const cor = metodo === 'POST'  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
            : metodo === 'GET'   ? 'bg-sky-950/60 text-sky-300 border-sky-800/50'
            : metodo === 'PATCH' ? 'bg-yellow-950/60 text-yellow-300 border-yellow-800/50'
            : 'bg-slate-800 text-slate-400 border-slate-600'
  return (
    <span className={`text-xs font-mono border px-2 py-0.5 rounded ${cor}`}>
      {metodo} {rota}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface ClienteItem {
  id: string; email: string
  pf?: { nomeCompleto: string }; pj?: { razaoSocial: string }
}
function getNome(c: ClienteItem) {
  return c.pf?.nomeCompleto ?? c.pj?.razaoSocial ?? c.email
}

interface Plano { id: string; nome: string; precoMensal: number | string; limiteUsuario: number }

interface Licenca {
  id: string; chaveAtivacao: string; isTrial: boolean; status: string
  criadoEm: string; dataVencimento: string | null; diasCortesia: number
  nomeDispositivo: string | null; totalUsuarios: number
  usuariosExtras: number; ultimaSincronizacao: string | null
  plano: { nome: string; precoMensal?: number; limiteUsuario?: number } | null
}

// ---------------------------------------------------------------------------
// Helpers visuais
// ---------------------------------------------------------------------------
function diasRestantes(dataVencimento: string | null) {
  if (!dataVencimento) return 0
  return Math.ceil((new Date(dataVencimento).getTime() - Date.now()) / 86_400_000)
}

function BarraDias({ restantes, total }: { restantes: number; total: number }) {
  const pct = Math.max(0, Math.min(100, (restantes / total) * 100))
  const cor = restantes > 7 ? 'bg-emerald-500' : restantes > 3 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="w-full bg-slate-700/60 rounded-full h-1.5">
      <div className={`${cor} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function BadgeDias({ licenca }: { licenca: Licenca }) {
  const restantes = diasRestantes(licenca.dataVencimento)
  const vencida   = restantes <= 0 && licenca.dataVencimento !== null
  if (vencida) return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 border border-red-700/50">VENCIDA</span>
  if (licenca.isTrial) return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-300 border border-orange-700/50">TRIAL · {restantes}d</span>
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-700/50">ATIVA · {restantes}d</span>
}

function BadgeStatus({ status }: { status: string }) {
  const mapa: Record<string, string> = {
    ATIVA:     'bg-emerald-900/50 text-emerald-300 border-emerald-700/50',
    BLOQUEADA: 'bg-red-900/50 text-red-300 border-red-700/50',
    VENCIDA:   'bg-slate-800 text-slate-400 border-slate-600',
    AGUARDANDO:'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
  }
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${mapa[status] ?? 'bg-slate-800 text-slate-400 border-slate-600'}`}>
      {status}
    </span>
  )
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Token display (quando conectar / validar retorna JWT)
// ---------------------------------------------------------------------------
function TokenDisplay({ token }: { token: string }) {
  const [copiado, setCopiado] = useState(false)
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(atob(token.split('.')[1])) } catch { /* ignore */ }

  const copiar = () => {
    navigator.clipboard.writeText(token).then(() => {
      setCopiado(true); setTimeout(() => setCopiado(false), 2000)
    })
  }

  return (
    <div className="p-3 rounded-lg border border-emerald-700/40 bg-emerald-950/20 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">Token JWT · {payload.gracePeriodDias as number} dias offline</span>
        <button onClick={copiar} className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-700/50 px-2 py-0.5 rounded transition">
          {copiado ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs font-mono">
        {(
          [
            ['licencaId',    payload.licencaId],
            ['plano',        payload.plano],
            ['limite',       `${payload.limite} usuário(s)`],
            ['vence',        payload.dataVencimento ? fmtData(payload.dataVencimento as string) : '—'],
            ['sincronizado', payload.ultimaSincronizacao ? new Date(payload.ultimaSincronizacao as string).toLocaleString('pt-BR') : '—'],
            ['exp JWT',      payload.exp ? new Date((payload.exp as number) * 1000).toLocaleString('pt-BR') : '—'],
          ] as Array<[string, unknown]>
        ).map(([k, v]) => (
          <React.Fragment key={k}>
            <span className="text-slate-500 whitespace-nowrap">{k}:</span>
            <span className="text-slate-300 truncate">{String(v ?? '—')}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GERENCIAR LICENÇAS (admin)
// ---------------------------------------------------------------------------
function SecaoGerenciarLicencas() {
  const [planos, setPlanos]         = useState<Plano[]>([])
  const [erroPlanos, setErroPlanos] = useState('')

  useEffect(() => {
    api('/api/licenca/planos').then(r => {
      if (!r.ok) { setErroPlanos(`Erro ${r.status}: servidor NestJS offline?`); return }
      const lista = (r.payload as any)?.data ?? []
      setPlanos(Array.isArray(lista) ? lista : [])
    })
  }, [])

  const [termo, setTermo]                       = useState('')
  const [clientes, setClientes]                 = useState<ClienteItem[]>([])
  const [buscando, setBuscando]                 = useState(false)
  const [erroClientes, setErroClientes]         = useState('')
  const [clienteSel, setClienteSel]             = useState<ClienteItem | null>(null)
  const [licencas, setLicencas]                 = useState<Licenca[]>([])
  const [buscandoLic, setBuscandoLic]           = useState(false)
  const [novaLic, setNovaLic]                   = useState({ planoId: '', nomeDispositivo: '', dias: '14' })
  const [loadCriar, setLoadCriar]               = useState(false)
  const [resultCriar, setResultCriar]           = useState<ApiResponse | null>(null)
  const [mesesPor, setMesesPor]                 = useState<Record<string, number>>({})
  const [loadRenovar, setLoadRenovar]           = useState<Record<string, boolean>>({})
  const [resultRenovar, setResultRenovar]       = useState<Record<string, ApiResponse>>({})
  const [adminLoading, setAdminLoading]         = useState<Record<string, boolean>>({})
  const [adminResultado, setAdminResultado]     = useState<Record<string, ApiResponse>>({})

  const buscarClientes = async () => {
    setBuscando(true); setErroClientes(''); setClientes([]); setClienteSel(null)
    setLicencas([]); setResultRenovar({}); setResultCriar(null); setAdminResultado({})
    const url = termo.trim() ? `/api/cliente?q=${encodeURIComponent(termo.trim())}` : '/api/cliente'
    const r = await api(url)
    setBuscando(false)
    if (!r.ok) { setErroClientes('Erro ao buscar clientes'); return }
    const lista = (r.payload as any)?.data ?? (r.payload as any) ?? []
    setClientes(Array.isArray(lista) ? lista : [lista])
  }

  const selecionarCliente = async (c: ClienteItem) => {
    setClienteSel(c); setLicencas([]); setResultRenovar({}); setResultCriar(null)
    setAdminResultado({}); setNovaLic({ planoId: '', nomeDispositivo: '', dias: '14' })
    setBuscandoLic(true)
    const r = await api(`/api/licenca/cliente/${c.id}`)
    setBuscandoLic(false)
    if (!r.ok) return
    const lista = (r.payload as any)?.data ?? (r.payload as any) ?? []
    setLicencas(Array.isArray(lista) ? lista : [lista])
  }

  const criarTrial = async () => {
    if (!clienteSel || !novaLic.planoId) return
    setLoadCriar(true); setResultCriar(null)
    const r = await api('/api/licenca', {
      method: 'POST',
      body: JSON.stringify({
        clienteId: clienteSel.id, planoId: novaLic.planoId,
        nomeDispositivo: novaLic.nomeDispositivo || undefined,
        dias: parseInt(novaLic.dias) || 14,
      }),
    })
    setLoadCriar(false); setResultCriar(r)
    if (r.ok) { const nova = (r.payload as any)?.data; if (nova) setLicencas([nova]) }
  }

  const gerarChave = async (licencaId: string) => {
    const meses = mesesPor[licencaId] ?? 1
    setLoadRenovar(prev => ({ ...prev, [licencaId]: true }))
    const r = await api(`/api/licenca/${licencaId}/renovar`, { method: 'POST', body: JSON.stringify({ meses }) })
    setLoadRenovar(prev => ({ ...prev, [licencaId]: false }))
    setResultRenovar(prev => ({ ...prev, [licencaId]: r }))
    if (r.ok) {
      const novaChave = (r.payload as any)?.data?.chaveAtivacao
      const novoVenc  = (r.payload as any)?.data?.dataVencimento
      if (novaChave)
        setLicencas(prev => prev.map(l =>
          l.id === licencaId ? { ...l, chaveAtivacao: novaChave, dataVencimento: novoVenc ?? l.dataVencimento, isTrial: false } : l
        ))
    }
  }

  type AdminAcao = 'bloquear' | 'reativar' | 'resetar' | 'extra'
  const acaoAdmin = async (licencaId: string, tipo: AdminAcao) => {
    const endpoints: Record<AdminAcao, string> = {
      bloquear: `/api/licenca/${licencaId}/bloquear`,
      reativar: `/api/licenca/${licencaId}/reativar`,
      resetar:  `/api/licenca/${licencaId}/resetar-usuarios`,
      extra:    `/api/licenca/${licencaId}/adicionar-extra`,
    }
    setAdminLoading(prev => ({ ...prev, [licencaId]: true }))
    const r = await api(endpoints[tipo], { method: 'PATCH' })
    setAdminLoading(prev => ({ ...prev, [licencaId]: false }))
    setAdminResultado(prev => ({ ...prev, [licencaId]: r }))
    if (r.ok) {
      setLicencas(prev => prev.map(l => {
        if (l.id !== licencaId) return l
        if (tipo === 'bloquear') return { ...l, status: 'BLOQUEADA' }
        if (tipo === 'reativar') return { ...l, status: 'ATIVA' }
        if (tipo === 'resetar')  return { ...l, totalUsuarios: 0 }
        if (tipo === 'extra')    return { ...l, usuariosExtras: l.usuariosExtras + 1 }
        return l
      }))
    }
  }

  const fn = (k: keyof typeof novaLic) => (e: ChangeEvent<HTMLInputElement>) =>
    setNovaLic(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <section className="bg-[#1e293b] p-6 rounded-xl border border-indigo-800/50 shadow-xl col-span-2">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-indigo-400 uppercase tracking-wider">Gerenciar Licenças</h2>
        <RotaBadge metodo="GET" rota="/api/licenca/cliente/:id" />
      </div>
      <p className="text-slate-500 text-xs mb-5">
        Busque um cliente, selecione-o e gerencie licenças: prazo, chave e ações admin.
      </p>

      <div className="flex gap-2 mb-4">
        <input className={`${ic} focus:border-indigo-500 flex-1`}
          placeholder="nome, CPF, CNPJ ou e-mail — vazio lista todos..."
          value={termo} onChange={e => setTermo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && buscarClientes()} />
        <button onClick={buscarClientes} disabled={buscando}
          className="px-4 py-2 rounded font-bold text-sm border border-indigo-600 text-indigo-300 hover:bg-indigo-600/20 disabled:opacity-50 transition whitespace-nowrap">
          {buscando ? 'Buscando...' : 'Buscar Clientes'}
        </button>
      </div>

      {erroClientes && <p className="text-red-400 text-xs mb-3">{erroClientes}</p>}

      {clientes.length > 0 && (
        <div className="mb-5">
          <p className="text-xs text-slate-500 uppercase font-bold mb-2">{clientes.length} cliente(s) encontrado(s)</p>
          <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
            {clientes.map(c => (
              <button key={c.id} onClick={() => selecionarCliente(c)}
                className={`text-left p-3 rounded-lg border transition ${
                  clienteSel?.id === c.id ? 'border-indigo-500 bg-indigo-600/20' : 'border-slate-700 bg-[#0f172a] hover:border-indigo-600/50'
                }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    c.pf ? 'bg-sky-900/50 text-sky-300 border border-sky-700/50' : 'bg-violet-900/50 text-violet-300 border border-violet-700/50'
                  }`}>{c.pf ? 'PF' : 'PJ'}</span>
                  <span className="text-sm font-semibold text-slate-200 truncate">{getNome(c)}</span>
                </div>
                <p className="text-xs text-slate-500 truncate">{c.email}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {clienteSel && (
        <div>
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-700">
            <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-400">
              {getNome(clienteSel)[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-200">{getNome(clienteSel)}</p>
              <p className="text-xs text-slate-500">{clienteSel.email}</p>
            </div>
          </div>

          {buscandoLic && <p className="text-slate-500 text-sm text-center py-6">Carregando licenças...</p>}

          {!buscandoLic && licencas.length === 0 && (
            <div className="border border-dashed border-orange-700/50 rounded-xl p-5 bg-orange-950/10">
              <p className="text-orange-400 font-bold text-sm mb-1">Nenhuma licença encontrada</p>
              <p className="text-slate-500 text-xs mb-4">Crie a licença trial inicial para este cliente.</p>
              {erroPlanos && <div className="mb-3 p-2 rounded bg-red-950/50 border border-red-700/50 text-red-400 text-xs">{erroPlanos}</div>}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label="Plano *">
                  <select className={`${ic} focus:border-orange-500`}
                    value={novaLic.planoId} onChange={e => setNovaLic(prev => ({ ...prev, planoId: e.target.value }))}>
                    <option value="">{planos.length === 0 ? '— servidor offline ou sem planos —' : '— selecione —'}</option>
                    {planos.map(p => <option key={p.id} value={p.id}>{p.nome} · R${Number(p.precoMensal).toFixed(2)}/mês · {p.limiteUsuario}u</option>)}
                  </select>
                </Field>
                <Field label="Nome do Dispositivo (opcional)">
                  <input className={`${ic} focus:border-orange-500`} placeholder="Ex: Computador Principal" value={novaLic.nomeDispositivo} onChange={fn('nomeDispositivo')} />
                </Field>
                <Field label="Dias de Trial">
                  <div className="flex gap-1.5">
                    {['7', '14', '30'].map(d => (
                      <button key={d} onClick={() => setNovaLic(prev => ({ ...prev, dias: d }))}
                        className={`flex-1 py-2 rounded text-xs font-bold border transition ${
                          novaLic.dias === d ? 'bg-orange-700 border-orange-500 text-white' : 'bg-transparent border-slate-600 text-slate-400 hover:border-orange-600'
                        }`}>{d}d</button>
                    ))}
                    <input type="number" className={`${ic} focus:border-orange-500 w-16 text-center`}
                      value={novaLic.dias} onChange={fn('dias')} min={1} max={365} />
                  </div>
                </Field>
              </div>
              <button onClick={criarTrial} disabled={loadCriar || !novaLic.planoId}
                className="w-full bg-orange-700 hover:bg-orange-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
                {loadCriar ? 'Criando...' : `Criar Licença Trial — ${novaLic.dias} dias`}
              </button>
              {resultCriar && <Console response={resultCriar} />}
            </div>
          )}

          {!buscandoLic && licencas.length > 0 && (
            <div className="space-y-4">
              {licencas.map(l => {
                const restantes  = diasRestantes(l.dataVencimento)
                const vencida    = restantes <= 0 && l.dataVencimento !== null
                const total      = l.diasCortesia || 30
                const meses      = mesesPor[l.id] ?? 1
                const isLoading  = loadRenovar[l.id] ?? false
                const adminLoad  = adminLoading[l.id] ?? false
                const adminRes   = adminResultado[l.id]
                const limiteEfetivo = (l.plano?.limiteUsuario ?? 1) + l.usuariosExtras

                return (
                  <div key={l.id} className={`p-4 rounded-lg border ${
                    l.status === 'BLOQUEADA' ? 'border-red-800/50 bg-red-950/20'
                    : vencida ? 'border-slate-700 bg-slate-800/30'
                    : 'border-emerald-800/30 bg-emerald-950/10'
                  }`}>
                    {/* Cabeçalho */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-bold text-slate-200">{l.nomeDispositivo ?? '—'}</span>
                          <BadgeDias licenca={l} />
                          <BadgeStatus status={l.status} />
                          {l.totalUsuarios > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300 border border-blue-700/50">
                              {l.totalUsuarios}/{limiteEfetivo} usuário(s)
                            </span>
                          )}
                        </div>

                        {l.isTrial && !vencida && l.dataVencimento && (
                          <div className="mb-2">
                            <BarraDias restantes={restantes} total={total} />
                            <p className="text-[10px] text-slate-600 mt-0.5">{restantes} de {total} dias · vence {fmtData(l.dataVencimento)}</p>
                          </div>
                        )}

                        <p className="text-xs text-slate-500 mb-0.5">
                          Plano: <span className="text-slate-400">{l.plano?.nome ?? '—'}</span>
                          {' · '}{limiteEfetivo} usuário(s) max
                          {l.usuariosExtras > 0 && <span className="text-blue-400"> (+{l.usuariosExtras} extra{l.usuariosExtras > 1 ? 's' : ''})</span>}
                          {l.dataVencimento && !l.isTrial && (
                            <> · Vence: <span className={vencida ? 'text-red-400' : 'text-emerald-400'}>{fmtData(l.dataVencimento)}</span></>
                          )}
                        </p>
                        <p className="text-[11px] font-mono text-slate-600 truncate">Chave: {l.chaveAtivacao}</p>
                        {l.ultimaSincronizacao && (
                          <p className="text-[10px] text-slate-700">Última sync: {new Date(l.ultimaSincronizacao).toLocaleString('pt-BR')}</p>
                        )}
                      </div>

                      {/* Renovar */}
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <p className="text-[10px] text-slate-600 uppercase font-bold">Renovar (meses)</p>
                        <div className="flex gap-1">
                          {[1, 3, 6, 12].map(m => (
                            <button key={m} onClick={() => setMesesPor(prev => ({ ...prev, [l.id]: m }))}
                              className={`w-9 py-1 rounded text-xs font-bold border transition ${
                                meses === m ? 'bg-emerald-700 border-emerald-500 text-white' : 'bg-transparent border-slate-600 text-slate-400 hover:border-emerald-600'
                              }`}>{m}m</button>
                          ))}
                        </div>
                        <button onClick={() => gerarChave(l.id)} disabled={isLoading}
                          className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white transition">
                          {isLoading ? 'Gerando...' : 'Gerar Chave'}
                        </button>
                      </div>
                    </div>

                    {/* Resultado renovação */}
                    {resultRenovar[l.id] && (
                      <div className={`mt-3 p-3 rounded text-xs font-mono border ${
                        resultRenovar[l.id].ok
                          ? 'bg-emerald-950/40 border-emerald-700/40 text-emerald-300'
                          : 'bg-red-950/40 border-red-700/40 text-red-300'
                      }`}>
                        {resultRenovar[l.id].ok
                          ? <><p className="font-bold mb-1">Chave gerada e e-mail enviado</p><p className="tracking-widest text-sm">{(resultRenovar[l.id].payload as any)?.data?.chaveAtivacao}</p></>
                          : <p>{JSON.stringify((resultRenovar[l.id].payload as any)?.erro ?? resultRenovar[l.id].payload)}</p>}
                      </div>
                    )}

                    {/* Ações admin */}
                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                      <p className="text-[10px] text-slate-600 uppercase font-bold mb-2">Ações Admin</p>
                      <div className="flex flex-wrap gap-1.5">
                        {l.status !== 'BLOQUEADA'
                          ? <button onClick={() => acaoAdmin(l.id, 'bloquear')} disabled={adminLoad}
                              className="px-2.5 py-1 rounded text-xs font-bold border border-red-700/60 text-red-400 hover:bg-red-900/30 disabled:opacity-50 transition">
                              Bloquear
                            </button>
                          : <button onClick={() => acaoAdmin(l.id, 'reativar')} disabled={adminLoad}
                              className="px-2.5 py-1 rounded text-xs font-bold border border-emerald-700/60 text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-50 transition">
                              Reativar
                            </button>
                        }
                        <button onClick={() => acaoAdmin(l.id, 'resetar')} disabled={adminLoad}
                          className="px-2.5 py-1 rounded text-xs font-bold border border-yellow-700/60 text-yellow-400 hover:bg-yellow-900/30 disabled:opacity-50 transition">
                          Resetar Usuários
                        </button>
                        <button onClick={() => acaoAdmin(l.id, 'extra')} disabled={adminLoad}
                          className="px-2.5 py-1 rounded text-xs font-bold border border-sky-700/60 text-sky-400 hover:bg-sky-900/30 disabled:opacity-50 transition">
                          +1 Usuário Extra
                        </button>
                      </div>
                      {adminLoad && <p className="text-slate-500 text-xs mt-2">Executando...</p>}
                      {adminRes && (
                        <p className={`text-xs mt-2 font-mono ${adminRes.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                          {adminRes.ok
                            ? (adminRes.payload as any)?.msg ?? 'OK'
                            : JSON.stringify((adminRes.payload as any)?.erro ?? adminRes.payload)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// SIMULAR ERP (endpoints públicos que o software local chama)
// ---------------------------------------------------------------------------
type Aba = 'auto-cadastro' | 'conectar' | 'validar' | 'desconectar' | 'heartbeat'

function SecaoSimularERP() {
  const [aba, setAba] = useState<Aba>('auto-cadastro')

  // Auto-Cadastro
  const [acDocumento, setAcDocumento] = useState('')
  const [acTipo, setAcTipo]       = useState<'PF'|'PJ'>('PJ')
  const [acNome, setAcNome]       = useState('')
  const [acEmail, setAcEmail]     = useState('')
  const [loadAc, setLoadAc]       = useState(false)
  const [resultAc, setResultAc]   = useState<ApiResponse | null>(null)
  const tokenAc = (resultAc?.payload as any)?.token as string | undefined

  // Conectar
  const [chaveConectar, setChaveConectar]   = useState('')
  const [loadConectar, setLoadConectar]     = useState(false)
  const [resultConectar, setResultConectar] = useState<ApiResponse | null>(null)
  const tokenConectar = (resultConectar?.payload as any)?.token as string | undefined

  // Validar
  const [chaveValidar, setChaveValidar]         = useState('')
  const [totalUsuariosValidar, setTotalUsuariosValidar] = useState('')
  const [loadValidar, setLoadValidar]           = useState(false)
  const [resultValidar, setResultValidar]       = useState<ApiResponse | null>(null)
  const tokenValidar = (resultValidar?.payload as any)?.token as string | undefined

  // Desconectar
  const [chaveDesconectar, setChaveDesconectar]   = useState('')
  const [loadDesconectar, setLoadDesconectar]     = useState(false)
  const [resultDesconectar, setResultDesconectar] = useState<ApiResponse | null>(null)

  // Heartbeat
  const [licencaIdHb, setLicencaIdHb]             = useState('')
  const [totalUsuariosHb, setTotalUsuariosHb]     = useState('')
  const [loadHb, setLoadHb]                       = useState(false)
  const [resultHb, setResultHb]                   = useState<ApiResponse | null>(null)

  const ERP_API = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.startbig.com.br'

  const autoCadastro = async () => {
    setLoadAc(true); setResultAc(null)
    const payload = { tipo: acTipo, documento: acDocumento, nomeOuRazao: acNome, email: acEmail }
    const r = await api(`${ERP_API}/erp/auto-cadastro`, { method: 'POST', body: JSON.stringify(payload) })
    setLoadAc(false); setResultAc(r)
    const chv = (r.payload as any)?.chaveAtivacao
    if (chv) setChaveConectar(chv)
  }

  const conectar = async () => {
    setLoadConectar(true); setResultConectar(null)
    const r = await api(`${ERP_API}/erp/conectar`, { method: 'POST', body: JSON.stringify({ chave: chaveConectar }) })
    setLoadConectar(false); setResultConectar(r)
    const licId = (r.payload as any)?.licencaId
    if (licId) setLicencaIdHb(licId)
  }

  const validar = async () => {
    setLoadValidar(true); setResultValidar(null)
    const payload: Record<string, unknown> = { chave: chaveValidar }
    if (totalUsuariosValidar.trim()) payload.totalUsuarios = parseInt(totalUsuariosValidar)
    const r = await api(`${ERP_API}/erp/validar`, { method: 'POST', body: JSON.stringify(payload) })
    setLoadValidar(false); setResultValidar(r)
  }

  const desconectar = async () => {
    setLoadDesconectar(true); setResultDesconectar(null)
    const r = await api(`${ERP_API}/erp/desconectar`, { method: 'POST', body: JSON.stringify({ chave: chaveDesconectar }) })
    setLoadDesconectar(false); setResultDesconectar(r)
  }

  const heartbeat = async () => {
    setLoadHb(true); setResultHb(null)
    const payload: Record<string, unknown> = { licencaId: licencaIdHb }
    if (totalUsuariosHb.trim()) payload.totalUsuarios = parseInt(totalUsuariosHb)
    const r = await api(`${ERP_API}/erp/heartbeat`, { method: 'POST', body: JSON.stringify(payload) })
    setLoadHb(false); setResultHb(r)
  }

  const abas: { id: Aba; label: string; metodo: string; rota: string; cor: string }[] = [
    { id: 'auto-cadastro', label: 'Auto-Cadastro', metodo: 'POST', rota: '/erp/auto-cadastro', cor: 'fuchsia'},
    { id: 'conectar',    label: 'Conectar',    metodo: 'POST', rota: '/erp/conectar',    cor: 'emerald' },
    { id: 'validar',     label: 'Validar',     metodo: 'POST', rota: '/erp/validar',     cor: 'sky'     },
    { id: 'desconectar', label: 'Desconectar', metodo: 'POST', rota: '/erp/desconectar', cor: 'orange'  },
    { id: 'heartbeat',   label: 'Heartbeat',   metodo: 'POST', rota: '/erp/heartbeat',   cor: 'violet'  },
  ]

  const corMap: Record<string, { btn: string; border: string; bg: string }> = {
    fuchsia: { btn: 'border-fuchsia-600 text-fuchsia-300 bg-fuchsia-600/20', border: 'border-fuchsia-700/60', bg: 'bg-fuchsia-950/10' },
    emerald: { btn: 'border-emerald-600 text-emerald-300 bg-emerald-600/20', border: 'border-emerald-700/60', bg: 'bg-emerald-950/10' },
    sky:     { btn: 'border-sky-600 text-sky-300 bg-sky-600/20',             border: 'border-sky-700/60',     bg: 'bg-sky-950/10'     },
    orange:  { btn: 'border-orange-600 text-orange-300 bg-orange-600/20',    border: 'border-orange-700/60',  bg: 'bg-orange-950/10'  },
    violet:  { btn: 'border-violet-600 text-violet-300 bg-violet-600/20',    border: 'border-violet-700/60',  bg: 'bg-violet-950/10'  },
  }

  const abaAtual = abas.find(a => a.id === aba)!
  const cores    = corMap[abaAtual.cor]

  return (
    <section className="bg-[#1e293b] p-6 rounded-xl border border-slate-700/60 shadow-xl col-span-2">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-slate-300 uppercase tracking-wider">Simular ERP</h2>
        <span className="text-xs text-slate-500 font-mono bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">
          endpoints públicos · sem autenticação admin
        </span>
      </div>
      <p className="text-slate-500 text-xs mb-5">
        Simule o que o software instalado no PC do cliente faz ao se comunicar com a plataforma.
      </p>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5">
        {abas.map(a => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={`px-3 py-1.5 rounded text-xs font-bold border transition ${
              aba === a.id ? corMap[a.cor].btn : 'border-slate-700 text-slate-500 hover:border-slate-500'
            }`}>
            {a.label}
          </button>
        ))}
      </div>

      {/* Conteúdo da aba */}
      <div className={`p-4 rounded-xl border ${cores.border} ${cores.bg}`}>
        <div className="flex items-center gap-2 mb-4">
          <RotaBadge metodo={abaAtual.metodo} rota={abaAtual.rota} />
          <span className="text-xs text-slate-500">
            {aba === 'auto-cadastro' && '→ bate na Receita Federal, cria cliente, emite trial e envia e-mail de primeiro acesso'}
            {aba === 'conectar'    && '→ valida chave, emite JWT RS256 (expira em min(7d, dias até vencimento))'}
            {aba === 'validar'     && '→ verifica licença, renova JWT, marca primeira ativação se AGUARDANDO'}
            {aba === 'desconectar' && '→ encerra sessão, libera slot de usuário'}
            {aba === 'heartbeat'   && '→ sinal de vida a cada 10 min, verifica se licença ainda está ATIVA'}
          </span>
        </div>

        {/* Auto-Cadastro */}
        {aba === 'auto-cadastro' && (
          <div className="space-y-3">
            <Field label="Tipo *">
              <select className={`${ic} focus:border-fuchsia-500`} value={acTipo} onChange={e => setAcTipo(e.target.value as 'PF'|'PJ')}>
                <option value="PJ">PJ (CNPJ)</option>
                <option value="PF">PF (CPF)</option>
              </select>
            </Field>
            <Field label="Documento *">
              <input className={`${ic} focus:border-fuchsia-500 font-mono`}
                placeholder="CNPJ ou CPF (Será checado na Receita!)"
                value={acDocumento} onChange={e => setAcDocumento(e.target.value)} />
            </Field>
            <Field label="Nome ou Razão Social *">
              <input className={`${ic} focus:border-fuchsia-500`}
                placeholder="Ex: StartBig LTDA"
                value={acNome} onChange={e => setAcNome(e.target.value)} />
            </Field>
            <Field label="E-mail *">
              <input type="email" className={`${ic} focus:border-fuchsia-500`}
                placeholder="admin@empresa.com"
                value={acEmail} onChange={e => setAcEmail(e.target.value)} />
            </Field>
            <button onClick={autoCadastro} disabled={loadAc || !acDocumento || !acNome || !acEmail}
              className="w-full bg-fuchsia-700 hover:bg-fuchsia-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
              {loadAc ? 'Cadastrando e Gerando Trial...' : 'POST /licenca/auto-cadastro'}
            </button>
            {tokenAc && <TokenDisplay token={tokenAc} />}
            {resultAc && <Console response={resultAc} />}
          </div>
        )}

        {/* Conectar */}
        {aba === 'conectar' && (
          <div className="space-y-3">
            <Field label="Chave de Ativação *">
              <input className={`${ic} focus:border-emerald-500 font-mono uppercase tracking-widest`}
                placeholder="START-XXXXXXXX ou TRIAL-XXXXXXXX"
                value={chaveConectar} onChange={e => setChaveConectar(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && conectar()} />
            </Field>
            <button onClick={conectar} disabled={loadConectar || !chaveConectar.trim()}
              className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
              {loadConectar ? 'Conectando...' : 'POST /licenca/conectar'}
            </button>
            {tokenConectar && <TokenDisplay token={tokenConectar} />}
            {resultConectar && <Console response={resultConectar} />}
          </div>
        )}

        {/* Validar */}
        {aba === 'validar' && (
          <div className="space-y-3">
            <Field label="Chave de Ativação *">
              <input className={`${ic} focus:border-sky-500 font-mono uppercase tracking-widest`}
                placeholder="START-XXXXXXXX ou TRIAL-XXXXXXXX"
                value={chaveValidar} onChange={e => setChaveValidar(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && validar()} />
            </Field>
            <Field label="Total de Usuários (opcional)">
              <input type="number" className={`${ic} focus:border-sky-500`}
                placeholder="Ex: 5"
                value={totalUsuariosValidar} onChange={e => setTotalUsuariosValidar(e.target.value)}
                min={0} />
            </Field>
            <button onClick={validar} disabled={loadValidar || !chaveValidar.trim()}
              className="w-full bg-sky-700 hover:bg-sky-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
              {loadValidar ? 'Validando...' : 'POST /licenca/validar'}
            </button>
            {tokenValidar && <TokenDisplay token={tokenValidar} />}
            {resultValidar && <Console response={resultValidar} />}
          </div>
        )}

        {/* Desconectar */}
        {aba === 'desconectar' && (
          <div className="space-y-3">
            <Field label="Chave de Ativação *">
              <input className={`${ic} focus:border-orange-500 font-mono uppercase tracking-widest`}
                placeholder="START-XXXXXXXX"
                value={chaveDesconectar} onChange={e => setChaveDesconectar(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && desconectar()} />
            </Field>
            <button onClick={desconectar} disabled={loadDesconectar || !chaveDesconectar.trim()}
              className="w-full bg-orange-700 hover:bg-orange-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
              {loadDesconectar ? 'Desconectando...' : 'POST /licenca/desconectar'}
            </button>
            {resultDesconectar && <Console response={resultDesconectar} />}
          </div>
        )}

        {/* Heartbeat */}
        {aba === 'heartbeat' && (
          <div className="space-y-3">
            <div className="p-3 rounded bg-violet-950/30 border border-violet-800/40 text-xs text-violet-300">
              O licencaId é preenchido automaticamente após um Conectar bem-sucedido nesta mesma sessão de debug.
            </div>
            <Field label="licencaId *">
              <input className={`${ic} focus:border-violet-500 font-mono`}
                placeholder="uuid da licença"
                value={licencaIdHb} onChange={e => setLicencaIdHb(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && heartbeat()} />
            </Field>
            <Field label="Total de Usuários (opcional)">
              <input type="number" className={`${ic} focus:border-violet-500`}
                placeholder="Ex: 3"
                value={totalUsuariosHb} onChange={e => setTotalUsuariosHb(e.target.value)}
                min={0} />
            </Field>
            <button onClick={heartbeat} disabled={loadHb || !licencaIdHb.trim()}
              className="w-full bg-violet-700 hover:bg-violet-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
              {loadHb ? 'Enviando...' : 'POST /licenca/heartbeat'}
            </button>
            {resultHb && <Console response={resultHb} />}
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------
export function TemaLicencas() {
  return (
    <>
      <SecaoGerenciarLicencas />
      <SecaoSimularERP />
    </>
  )
}
