'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail]         = useState('')
  const [senha, setSenha]         = useState('')
  const [verSenha, setVerSenha]   = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro]           = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCarregando(true)
    setErro(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErro(data.erro ?? data.message ?? 'Credenciais inválidas.')
        return
      }

      if (data.user) {
        localStorage.setItem('user_data', JSON.stringify(data.user))
      }

      router.push('/dashboard')
    } catch {
      setErro('Falha ao conectar com o servidor.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {erro && (
        <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          {erro}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide">
          E-mail
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="admin@exemplo.com"
          className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-600 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/60 transition-all"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Senha
        </label>
        <div className="relative">
          <input
            type={verSenha ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={senha}
            onChange={e => setSenha(e.target.value)}
            placeholder="••••••••"
            className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-600 text-sm rounded-lg pl-3 pr-10 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/60 transition-all"
          />
          <button
            type="button"
            onClick={() => setVerSenha(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            tabIndex={-1}
          >
            {verSenha ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={carregando}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-lg transition-colors shadow-lg shadow-blue-900/30"
      >
        {carregando && <Loader2 size={14} className="animate-spin" />}
        {carregando ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  )
}
