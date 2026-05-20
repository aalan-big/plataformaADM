'use client'

import { useState, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'
import { SenhaInput } from '../_shared/SenhaInput'

interface UsuarioLogado { id: string; nome: string; email: string }
interface ApiResponse { ok: boolean; status: number; data: unknown }

async function req(url: string, body: unknown): Promise<ApiResponse> {
  const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let data;
  try { data = await res.json() } catch { data = { erro: res.statusText || 'Resposta vazia ou inválida' } }
  return { ok: res.ok, status: res.status, data }
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0f172a] p-5 space-y-3">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{titulo}</p>
      {children}
    </div>
  )
}

function inp(placeholder: string, value: string, onChange: (e: ChangeEvent<HTMLInputElement>) => void, type = 'text') {
  return (
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder}
      className="w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
    />
  )
}

function SecaoCadastro() {
  const [nome,  setNome]  = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [tipo,  setTipo]  = useState('ADMIN')
  const [res,   setRes]   = useState<ApiResponse | null>(null)

  async function enviar() {
    setRes(await req('/api/usuario', { nome, email, senha, tipo }))
  }

  return (
    <Secao titulo="POST /api/usuario — Criar Usuário">
      {inp('Nome', nome, e => setNome(e.target.value))}
      {inp('E-mail', email, e => setEmail(e.target.value), 'email')}
      <SenhaInput value={senha} onChange={e => setSenha(e.target.value)} />
      <select value={tipo} onChange={e => setTipo(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none">
        <option value="ADMIN">ADMIN</option>
        <option value="GERENTE">GERENTE</option>
        <option value="SUPORTE">SUPORTE</option>
      </select>
      <button onClick={enviar} className="w-full py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold rounded-lg transition-colors">Cadastrar</button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoLogin({ onLogin }: { onLogin: (u: UsuarioLogado) => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [res,   setRes]   = useState<ApiResponse | null>(null)

  async function enviar() {
    const r = await req('/api/auth/login', { email, senha })
    setRes(r)
    if (r.ok && r.data && typeof r.data === 'object' && 'user' in r.data) {
      onLogin((r.data as { user: UsuarioLogado }).user)
    }
  }

  return (
    <Secao titulo="POST /api/auth/login — Login">
      {inp('E-mail', email, e => setEmail(e.target.value), 'email')}
      <SenhaInput value={senha} onChange={e => setSenha(e.target.value)} />
      <button onClick={enviar} className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors">Entrar</button>
      <Console response={res} />
    </Secao>
  )
}

export function TemaLogin({ onLogin }: { onLogin: (u: UsuarioLogado) => void }) {
  return (
    <>
      <SecaoCadastro />
      <SecaoLogin onLogin={onLogin} />
    </>
  )
}
