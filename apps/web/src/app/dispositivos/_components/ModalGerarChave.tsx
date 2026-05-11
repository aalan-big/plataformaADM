'use client'

import { useState } from 'react'
import { X, RefreshCw, Copy, CheckCheck, Loader2, AlertCircle, Key } from 'lucide-react'

type Licenca = {
  id: string
  nomeDispositivo?: string | null
  cliente: {
    email: string
    pf?: { nomeCompleto: string } | null
    pj?: { razaoSocial: string } | null
    tipo: 'PF' | 'PJ'
  }
  plano?: { nome: string } | null
  dataVencimento?: string | null
}

type ResultadoRenovacao = {
  chaveAtivacao: string
  dataVencimento: string
  emailEnviado: string | null
}

function nomeCliente(l: Licenca) {
  return l.cliente.tipo === 'PF'
    ? (l.cliente.pf?.nomeCompleto ?? l.cliente.email)
    : (l.cliente.pj?.razaoSocial ?? l.cliente.email)
}

function formatarData(iso: string) {
  const d = new Date(iso)
  const m = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${d.getDate().toString().padStart(2,'0')} ${m[d.getMonth()]} ${d.getFullYear()}`
}

const MESES_OPCOES = [1, 3, 6, 12]

interface Props {
  licenca: Licenca
  onClose: () => void
  onSuccess: () => void
}

export default function ModalGerarChave({ licenca, onClose, onSuccess }: Props) {
  const [meses, setMeses] = useState(1)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<ResultadoRenovacao | null>(null)
  const [copiado, setCopiado] = useState(false)

  async function renovar() {
    setErro('')
    setEnviando(true)
    try {
      const res = await fetch(`/api/licenca/${licenca.id}/renovar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meses }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErro(json.message ?? json.erro ?? 'Erro ao renovar licença.')
        return
      }
      setResultado(json.data)
    } catch {
      setErro('Falha de conexão.')
    } finally {
      setEnviando(false)
    }
  }

  async function copiarChave() {
    if (!resultado?.chaveAtivacao) return
    await navigator.clipboard.writeText(resultado.chaveAtivacao)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={resultado ? undefined : onClose} />

      <div className="relative z-10 w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-600/30 flex items-center justify-center">
              <Key size={14} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Gerar Chave de Ativação</h2>
              <p className="text-[11px] text-slate-500 truncate max-w-48">
                {nomeCliente(licenca)} · {licenca.nomeDispositivo ?? 'Dispositivo'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Corpo */}
        <div className="px-6 py-5 space-y-5">

          {!resultado ? (
            <>
              {/* Info da licença */}
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Cliente</span>
                  <span className="text-slate-200 font-medium">{nomeCliente(licenca)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Plano</span>
                  <span className="text-slate-300">{licenca.plano?.nome ?? '—'}</span>
                </div>
                {licenca.dataVencimento && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Vencimento atual</span>
                    <span className={`font-medium ${new Date(licenca.dataVencimento) < new Date() ? 'text-red-400' : 'text-slate-300'}`}>
                      {formatarData(licenca.dataVencimento)}
                    </span>
                  </div>
                )}
              </div>

              {/* Seleção de meses */}
              <div className="space-y-2">
                <label className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold">
                  Período de Renovação
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {MESES_OPCOES.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMeses(m)}
                      className={`py-2.5 rounded-lg text-sm font-semibold transition-colors border ${
                        meses === m
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {m === 1 ? '1 mês' : m === 12 ? '1 ano' : `${m}m`}
                    </button>
                  ))}
                </div>
              </div>

              {erro && (
                <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-sm">
                  <AlertCircle size={14} />
                  {erro}
                </div>
              )}

              <p className="text-[11px] text-slate-500 text-center">
                A chave será gerada e enviada por e-mail ao cliente automaticamente.
              </p>
            </>
          ) : (
            /* Resultado */
            <div className="space-y-4">
              <div className="text-center py-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
                  <CheckCheck size={20} className="text-emerald-400" />
                </div>
                <p className="text-white font-bold text-base">Licença Renovada!</p>
                <p className="text-slate-500 text-xs mt-1">
                  Novo vencimento: <span className="text-slate-300">{formatarData(resultado.dataVencimento)}</span>
                </p>
                {resultado.emailEnviado && (
                  <p className="text-emerald-400 text-xs mt-1">
                    Chave enviada para {resultado.emailEnviado}
                  </p>
                )}
                {!resultado.emailEnviado && (
                  <p className="text-yellow-400 text-xs mt-1">
                    E-mail não enviado — SMTP não configurado
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold">
                  Chave de Ativação
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 font-mono text-sm text-emerald-400 tracking-wider">
                    {resultado.chaveAtivacao}
                  </div>
                  <button
                    onClick={copiarChave}
                    className="p-2.5 bg-slate-800 border border-slate-700 hover:border-emerald-600/50 hover:bg-emerald-600/10 rounded-lg text-slate-400 hover:text-emerald-400 transition-colors"
                    title="Copiar chave"
                  >
                    {copiado ? <CheckCheck size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
          {!resultado ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={renovar}
                disabled={enviando}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg transition-colors shadow-lg shadow-emerald-900/30"
              >
                {enviando
                  ? <Loader2 size={13} className="animate-spin" />
                  : <RefreshCw size={13} />
                }
                Renovar & Gerar Chave
              </button>
            </>
          ) : (
            <button
              onClick={() => { onSuccess(); onClose() }}
              className="px-5 py-2 text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
