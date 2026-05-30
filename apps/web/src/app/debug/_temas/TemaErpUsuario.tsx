'use client'

import { useState } from 'react'
import { Console } from '../_shared/Console'

interface ApiResponse {
  ok: boolean; status?: number; statusText?: string; payload?: unknown; error?: string
}

async function api(url: string, token: string, options?: RequestInit): Promise<ApiResponse> {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      ...options,
    })
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

// ── Dados do Usuário ───────────────────────────────────────────────────────
function SecaoDados({ token }: { token: string }) {
  const [load, setLoad] = useState(false)
  const [res,  setRes]  = useState<ApiResponse | null>(null)

  const buscar = async () => {
    setLoad(true); setRes(null)
    const r = await api(`${API}/erp/usuario/dados`, token)
    setLoad(false); setRes(r)
  }

  const dados = res?.ok ? (res.payload as any) : null

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-sky-800/50 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-sky-400 uppercase tracking-wider">Dados do Usuário</h2>
        <RotaBadge metodo="GET" rota="/erp/usuario/dados" />
      </div>
      <p className="text-slate-500 text-xs mb-4">Retorna nome, e-mail e se o cliente já tem senha definida.</p>

      <button onClick={buscar} disabled={load || !token}
        className="w-full bg-sky-700 hover:bg-sky-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition mb-3">
        {load ? 'Buscando...' : 'GET /erp/usuario/dados'}
      </button>

      {dados && (
        <div className="p-3 rounded border border-sky-700/40 bg-sky-950/20 text-sm space-y-1 mb-2">
          <p><span className="text-slate-500 text-xs">Nome:</span> <span className="text-slate-200 font-semibold">{dados.nome || '—'}</span></p>
          <p><span className="text-slate-500 text-xs">E-mail:</span> <span className="text-slate-200">{dados.email}</span></p>
          <p><span className="text-slate-500 text-xs">Tem senha:</span>{' '}
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${dados.temSenha ? 'bg-emerald-900/50 text-emerald-300' : 'bg-orange-900/50 text-orange-300'}`}>
              {dados.temSenha ? 'Sim' : 'Não — primeiro acesso pendente'}
            </span>
          </p>
        </div>
      )}
      {res && <Console response={res} />}
    </section>
  )
}

// ── Alterar Senha ──────────────────────────────────────────────────────────
function SecaoAlterarSenha({ token }: { token: string }) {
  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha,  setNovaSenha]  = useState('')
  const [load,       setLoad]       = useState(false)
  const [res,        setRes]        = useState<ApiResponse | null>(null)

  const enviar = async () => {
    setLoad(true); setRes(null)
    const body: Record<string, string> = { novaSenha }
    if (senhaAtual.trim()) body.senhaAtual = senhaAtual
    const r = await api(`${API}/erp/usuario/alterar-senha`, token, {
      method: 'POST', body: JSON.stringify(body),
    })
    setLoad(false); setRes(r)
  }

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-violet-800/50 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-violet-400 uppercase tracking-wider">Alterar Senha</h2>
        <RotaBadge metodo="POST" rota="/erp/usuario/alterar-senha" />
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Se <code className="text-violet-300">temSenha: false</code> deixe "Senha Atual" vazio (primeiro acesso).
        Se <code className="text-violet-300">temSenha: true</code> informe a senha atual.
      </p>

      <div className="space-y-3">
        <Field label="Senha Atual (obrigatório só se já tem senha)">
          <input type="password" className={`${ic} focus:border-violet-500`}
            placeholder="Deixe vazio no primeiro acesso"
            value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} />
        </Field>
        <Field label="Nova Senha * (mín. 8 chars)">
          <input type="password" className={`${ic} focus:border-violet-500`}
            placeholder="••••••••"
            value={novaSenha} onChange={e => setNovaSenha(e.target.value)} />
        </Field>
        <button onClick={enviar} disabled={load || !token || novaSenha.length < 8}
          className="w-full bg-violet-700 hover:bg-violet-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
          {load ? 'Salvando...' : 'POST /erp/usuario/alterar-senha'}
        </button>
        {res && <Console response={res} />}
      </div>
    </section>
  )
}

// ── Solicitar Novo E-mail ──────────────────────────────────────────────────
function SecaoSolicitarEmail({ token }: { token: string }) {
  const [novoEmail,  setNovoEmail]  = useState('')
  const [senhaAtual, setSenhaAtual] = useState('')
  const [load,       setLoad]       = useState(false)
  const [res,        setRes]        = useState<ApiResponse | null>(null)

  const enviar = async () => {
    setLoad(true); setRes(null)
    const r = await api(`${API}/erp/usuario/solicitar-novo-email`, token, {
      method: 'POST', body: JSON.stringify({ novoEmail, senhaAtual }),
    })
    setLoad(false); setRes(r)
  }

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-rose-800/50 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-rose-400 uppercase tracking-wider">Trocar E-mail</h2>
        <RotaBadge metodo="POST" rota="/erp/usuario/solicitar-novo-email" />
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Envia link de confirmação para o novo e-mail via Resend. Confirme clicando no link.
      </p>

      <div className="space-y-3">
        <Field label="Novo E-mail *">
          <input type="email" className={`${ic} focus:border-rose-500`}
            placeholder="novo@empresa.com"
            value={novoEmail} onChange={e => setNovoEmail(e.target.value)} />
        </Field>
        <Field label="Senha Atual *">
          <input type="password" className={`${ic} focus:border-rose-500`}
            placeholder="••••••••"
            value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} />
        </Field>
        <button onClick={enviar} disabled={load || !token || !novoEmail || !senhaAtual}
          className="w-full bg-rose-700 hover:bg-rose-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
          {load ? 'Enviando...' : 'POST /erp/usuario/solicitar-novo-email'}
        </button>
        {res && <Console response={res} />}
      </div>
    </section>
  )
}

// ── Export ─────────────────────────────────────────────────────────────────
export function TemaErpUsuario({ token }: { token: string }) {
  return (
    <div className="space-y-4">
      {!token && (
        <div className="p-4 rounded-xl border border-yellow-700/50 bg-yellow-950/20 text-yellow-400 text-sm font-semibold text-center">
          Faça login no módulo ERP Auth acima para obter o token de licença.
        </div>
      )}
      <div className="grid grid-cols-2 gap-5">
        <SecaoDados token={token} />
        <SecaoAlterarSenha token={token} />
      </div>
      <SecaoSolicitarEmail token={token} />
    </div>
  )
}
