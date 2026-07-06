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

interface ErpLoginForm {
  baseUrl: string
  email: string
  senha: string
  hwid: string
}

function gerarHwidTeste() {
  return `DEBUG-LAB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function SecaoErpLogin() {
  const [form, setForm] = useState<ErpLoginForm>({
    baseUrl: 'https://api.startbig.com.br',
    email:   '',
    senha:   '',
    hwid:    gerarHwidTeste(),
  })
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const executar = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${form.baseUrl.replace(/\/$/, '')}/erp/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: form.email, senha: form.senha, hwid: form.hwid || undefined }),
      })
      const data = await res.json()
      setResponse({ status: res.status, statusText: res.statusText, ok: res.ok, payload: data })
    } catch (err) {
      setResponse({ error: 'Falha na conexão com a API', ok: false, payload: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const field = (key: keyof ErpLoginForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value })

  return (
    <section className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-xl">
      <h2 className="text-base font-bold text-cyan-400 mb-4 uppercase tracking-wider">
        Login ERP (cliente existente / reinstalação)
      </h2>
      <div className="space-y-3">
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">URL base da API</label>
          <input
            className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 focus:border-cyan-500 outline-none transition"
            placeholder="https://api.startbig.com.br"
            value={form.baseUrl}
            onChange={field('baseUrl')}
          />
        </div>
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">E-mail do cliente</label>
          <input
            className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 focus:border-cyan-500 outline-none transition"
            placeholder="contato@empresa.com"
            value={form.email}
            onChange={field('email')}
          />
        </div>
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Senha</label>
          <SenhaInput value={form.senha} onChange={field('senha')} />
        </div>
        <div>
          <label className="block text-xs uppercase font-bold text-slate-500 mb-1">HWID (dispositivo novo)</label>
          <input
            className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 focus:border-cyan-500 outline-none transition"
            placeholder="PC-DESKTOP-NOVO456"
            value={form.hwid}
            onChange={field('hwid')}
          />
        </div>
        <button
          disabled={loading}
          onClick={executar}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 text-white font-bold py-2 rounded transition mt-2"
        >
          {loading ? 'Processando...' : 'POST /erp/auth/login'}
        </button>
      </div>
      <Console response={response} />
    </section>
  )
}

export function TemaErpAuthLogin() {
  return <SecaoErpLogin />
}
