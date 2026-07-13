'use client'

import { useState } from 'react'
import { KeyRound, Loader2, X, Check, AlertTriangle } from 'lucide-react'

interface Props {
  clienteId:   string
  nomeCliente: string
  onClose:     () => void
}

export default function ModalDefinirSenha({ clienteId, nomeCliente, onClose }: Props) {
  const [senha, setSenha]         = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [processando, setProc]    = useState(false)
  const [erro, setErro]           = useState<string | null>(null)
  const [ok, setOk]               = useState(false)

  const podeSalvar = senha.length >= 8 && senha === confirmar && !processando

  async function salvar() {
    setErro(null)
    if (senha.length < 8)   { setErro('A senha deve ter no mínimo 8 caracteres.'); return }
    if (senha !== confirmar) { setErro('As senhas não coincidem.'); return }

    setProc(true)
    try {
      const res = await fetch(`/api/cliente/${clienteId}/definir-senha`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ senha }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json?.message ?? json?.erro ?? 'Não foi possível definir a senha.')
        return
      }
      setOk(true)
      setTimeout(onClose, 1200)
    } catch {
      setErro('Falha de conexão ao definir a senha.')
    } finally {
      setProc(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={processando ? undefined : onClose} />

      <div className="relative z-10 w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-amber-400">
            <KeyRound size={16} />
            <h2 className="font-bold text-white">Definir senha de acesso</h2>
          </div>
          <button
            onClick={onClose}
            disabled={processando}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-4">
          <p className="text-sm text-slate-300">
            Definindo a senha de <span className="text-amber-300 font-semibold">{nomeCliente}</span>.
            Ele poderá usar o e-mail cadastrado + esta senha para fazer login no ERP.
          </p>

          {ok ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-emerald-300 text-sm">
              <Check size={16} /> Senha definida com sucesso.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Nova senha</label>
                <input
                  type="password"
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 uppercase tracking-wide mb-1">Confirmar senha</label>
                <input
                  type="password"
                  value={confirmar}
                  onChange={e => setConfirmar(e.target.value)}
                  placeholder="Repita a senha"
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
              </div>

              {erro && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-300 text-xs">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {erro}
                </div>
              )}
            </>
          )}
        </div>

        {!ok && (
          <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={processando}
              className="px-4 py-2 text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={salvar}
              disabled={!podeSalvar}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {processando ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
              {processando ? 'Salvando...' : 'Definir senha'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
