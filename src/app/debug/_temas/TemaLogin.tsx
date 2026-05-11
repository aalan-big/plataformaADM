'use client'

import { useState, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'
import { SenhaInput } from '../_shared/SenhaInput'

interface ApiResponse {
  ok: boolean
  status?: number
  statusText?: string
  payload?: unknown
  error?: string
}

interface CadastroForm {
  nome: string
  email: string
  senha: string
  cargo: string
}

interface LoginForm {
  email: string
  senha: string
}

function SecaoCadastro() {
  const [form, setForm] = useState<CadastroForm>({ nome: '', email: '', senha: '', cargo: 'ADMIN' })
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const executar = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'testar_cadastro', dados: form }),
      })
      const data = await res.json()
      setResponse({ status: res.status, statusText: res.statusText, ok: res.ok, payload: data })
    } catch (err) {
      setResponse({ error: 'Falha na conexão com a API', ok: false, payload: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const field = (key: keyof CadastroForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value })

  return (
    <section className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-xl">
      <h2 className="text-base font-bold text-cyan-400 mb-4 uppercase tracking-wider">
        Cadastro de Usuário
      </h2>
      <div className="space-y-3">
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Nome Completo</label>
          <input
            className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 focus:border-cyan-500 outline-none transition"
            placeholder="Ex: Alan Alves"
            value={form.nome}
            onChange={field('nome')}
          />
        </div>
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">E-mail</label>
          <input
            className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 focus:border-cyan-500 outline-none transition"
            placeholder="admin@bigtec.com"
            value={form.email}
            onChange={field('email')}
          />
        </div>
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Senha</label>
          <SenhaInput value={form.senha} onChange={field('senha') as (e: ChangeEvent<HTMLInputElement>) => void} />
        </div>
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Cargo</label>
          <select
            className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 focus:border-cyan-500 outline-none transition"
            value={form.cargo}
            onChange={field('cargo')}
          >
            <option value="ADMIN">ADMIN</option>
            <option value="GERENTE">GERENTE</option>
            <option value="SUPORTE">SUPORTE</option>
          </select>
        </div>
        <button
          disabled={loading}
          onClick={executar}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 text-white font-bold py-2 rounded transition mt-2"
        >
          {loading ? 'Processando...' : 'POST /cadastro'}
        </button>
      </div>
      <Console response={response} />
    </section>
  )
}

function SecaoLogin() {
  const [form, setForm] = useState<LoginForm>({ email: '', senha: '' })
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const executar = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'testar_login', dados: form }),
      })
      const data = await res.json()
      setResponse({ status: res.status, statusText: res.statusText, ok: res.ok, payload: data })
    } catch (err) {
      setResponse({ error: 'Falha na conexão com a API', ok: false, payload: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const field = (key: keyof LoginForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value })

  return (
    <section className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-xl">
      <h2 className="text-base font-bold text-emerald-400 mb-4 uppercase tracking-wider">
        Login de Usuário
      </h2>
      <div className="space-y-3">
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">E-mail</label>
          <input
            className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 focus:border-emerald-500 outline-none transition"
            placeholder="admin@bigtec.com"
            value={form.email}
            onChange={field('email')}
          />
        </div>
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Senha</label>
          <SenhaInput value={form.senha} onChange={field('senha')} />
        </div>
        <button
          disabled={loading}
          onClick={executar}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white font-bold py-2 rounded transition mt-2"
        >
          {loading ? 'Processando...' : 'POST /login'}
        </button>
      </div>
      <Console response={response} />
    </section>
  )
}

export function TemaLogin() {
  return (
    <>
      <SecaoCadastro />
      <SecaoLogin />
    </>
  )
}
