'use client'

import { useState } from 'react'
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

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.startbig.com.br'
const ic  = 'w-full bg-[#0f172a] border border-slate-600 rounded p-2 outline-none transition text-sm'
const lc  = 'block text-xs uppercase font-bold text-slate-500 mb-1'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={lc}>{label}</label>{children}</div>
}

function RotaBadge({ metodo, rota }: { metodo: string; rota: string }) {
  const cor = metodo === 'POST' ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
            : 'bg-sky-950/60 text-sky-300 border-sky-800/50'
  return <span className={`text-xs font-mono border px-2 py-0.5 rounded ${cor}`}>{metodo} {rota}</span>
}

// ── Token copiável ─────────────────────────────────────────────────────────
function TokenDisplay({ token, onToken }: { token: string; onToken: (t: string) => void }) {
  const [copiado, setCopiado] = useState(false)
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(atob(token.split('.')[1])) } catch { /* ignore */ }

  const copiar = () => {
    navigator.clipboard.writeText(token).then(() => {
      setCopiado(true); setTimeout(() => setCopiado(false), 2000)
      onToken(token)
    })
  }

  return (
    <div className="p-3 rounded-lg border border-cyan-700/40 bg-cyan-950/20 mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wide">Token de Licença (RS256)</span>
        <button onClick={copiar} className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-700/50 px-2 py-0.5 rounded transition">
          {copiado ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs font-mono">
        {([
          ['licencaId', payload.licencaId],
          ['plano',     payload.plano],
          ['limite',    `${payload.limite} usuário(s)`],
          ['vence',     payload.dataVencimento ? new Date(payload.dataVencimento as string).toLocaleDateString('pt-BR') : '—'],
        ] as Array<[string, unknown]>).map(([k, v]) => (
          <><span key={k+'-k'} className="text-slate-500">{k}:</span><span key={k+'-v'} className="text-slate-300 truncate">{String(v ?? '—')}</span></>
        ))}
      </div>
    </div>
  )
}

// ── Login ──────────────────────────────────────────────────────────────────
function SecaoLogin({ onToken }: { onToken: (t: string) => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [hwid,  setHwid]  = useState('')
  const [load,  setLoad]  = useState(false)
  const [res,   setRes]   = useState<ApiResponse | null>(null)
  const token = (res?.payload as any)?.token as string | undefined

  const login = async () => {
    setLoad(true); setRes(null)
    const body: Record<string, string> = { email, senha }
    if (hwid.trim()) body.hwid = hwid
    const r = await api(`${API}/erp/auth/login`, { method: 'POST', body: JSON.stringify(body) })
    setLoad(false); setRes(r)
    if (r.ok && (r.payload as any)?.token) onToken((r.payload as any).token)
  }

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-cyan-800/50 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-cyan-400 uppercase tracking-wider">Login ERP</h2>
        <RotaBadge metodo="POST" rota="/erp/auth/login" />
      </div>
      <p className="text-slate-500 text-xs mb-4">Autentica com e-mail + senha e retorna token de licença RS256.</p>

      <div className="space-y-3">
        <Field label="E-mail *">
          <input type="email" className={`${ic} focus:border-cyan-500`}
            placeholder="cliente@empresa.com"
            value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha *">
          <input type="password" className={`${ic} focus:border-cyan-500`}
            placeholder="••••••••"
            value={senha} onChange={e => setSenha(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()} />
        </Field>
        <Field label="HWID (opcional)">
          <input className={`${ic} focus:border-cyan-500 font-mono text-xs`}
            placeholder="ID único da máquina"
            value={hwid} onChange={e => setHwid(e.target.value)} />
        </Field>
        <button onClick={login} disabled={load || !email || !senha}
          className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
          {load ? 'Autenticando...' : 'POST /erp/auth/login'}
        </button>
        {token && <TokenDisplay token={token} onToken={onToken} />}
        {res && <Console response={res} />}
      </div>
    </section>
  )
}

// ── Primeiro Acesso ────────────────────────────────────────────────────────
function SecaoPrimeiroAcesso() {
  const [token,     setToken]     = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [load,      setLoad]      = useState(false)
  const [res,       setRes]       = useState<ApiResponse | null>(null)

  const enviar = async () => {
    setLoad(true); setRes(null)
    const r = await api(`${API}/erp/auth/primeiro-acesso`, {
      method: 'POST', body: JSON.stringify({ token, novaSenha }),
    })
    setLoad(false); setRes(r)
  }

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-teal-800/50 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-teal-400 uppercase tracking-wider">Primeiro Acesso</h2>
        <RotaBadge metodo="POST" rota="/erp/auth/primeiro-acesso" />
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Define a senha usando o token recebido por e-mail após o auto-cadastro (válido por 7 dias).
      </p>

      <div className="space-y-3">
        <Field label="Token do e-mail *">
          <input className={`${ic} focus:border-teal-500 font-mono text-xs`}
            placeholder="UUID do token recebido no e-mail"
            value={token} onChange={e => setToken(e.target.value)} />
        </Field>
        <Field label="Nova Senha * (mín. 8 chars)">
          <input type="password" className={`${ic} focus:border-teal-500`}
            placeholder="••••••••"
            value={novaSenha} onChange={e => setNovaSenha(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && enviar()} />
        </Field>
        <button onClick={enviar} disabled={load || !token || novaSenha.length < 8}
          className="w-full bg-teal-700 hover:bg-teal-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
          {load ? 'Salvando...' : 'POST /erp/auth/primeiro-acesso'}
        </button>
        {res && <Console response={res} />}
      </div>
    </section>
  )
}

// ── Export ─────────────────────────────────────────────────────────────────
export function TemaErpAuth({ onToken }: { onToken: (t: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-5">
      <SecaoLogin onToken={onToken} />
      <SecaoPrimeiroAcesso />
    </div>
  )
}
