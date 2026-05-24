'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Search, Loader2, AlertCircle, Cpu, User } from 'lucide-react'

type ClienteOpc = {
  id: string
  email: string
  pf: { nomeCompleto: string } | null
  pj: { razaoSocial: string } | null
}

type Plano = {
  id: string
  nome: string
  precoMensal: number
}

function nomeCliente(c: ClienteOpc) {
  return c.pf ? (c.pf.nomeCompleto ?? c.email) : (c.pj?.razaoSocial ?? c.email)
}

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function ModalCriarTrial({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState<'cliente' | 'form'>('cliente')

  // step 1 — selecionar cliente
  const [busca, setBusca] = useState('')
  const [clientes, setClientes] = useState<ClienteOpc[]>([])
  const [buscando, setBuscando] = useState(false)
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteOpc | null>(null)

  // step 2 — preencher licença
  const [planos, setPlanos] = useState<Plano[]>([])
  const [planoId, setPlanoId] = useState('')
  const [hwid, setHwid] = useState('')
  const [nomeDispositivo, setNomeDispositivo] = useState('')
  const [dias, setDias] = useState(7)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const DIAS_OPCOES = [3, 7, 14, 30]

  const buscarClientes = useCallback(async (q: string) => {
    if (!q.trim()) { setClientes([]); return }
    setBuscando(true)
    try {
      const res = await fetch(`/api/cliente?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      setClientes(json.data ?? [])
    } catch {
      setClientes([])
    } finally {
      setBuscando(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => buscarClientes(busca), 350)
    return () => clearTimeout(t)
  }, [busca, buscarClientes])

  useEffect(() => {
    fetch('/api/licenca/planos')
      .then(r => r.json())
      .then(j => {
        const lista: Plano[] = j.data ?? []
        setPlanos(lista)
        if (lista.length > 0) setPlanoId(lista[0].id)
      })
      .catch(() => {})
  }, [])

  async function submeter() {
    if (!clienteSelecionado) return
    setErro('')
    setEnviando(true)
    try {
      const res = await fetch('/api/licenca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId:       clienteSelecionado.id,
          planoId:         planoId || undefined,
          hwid:            hwid.trim() || undefined,
          nomeDispositivo: nomeDispositivo.trim() || undefined,
          dias,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErro(json.message ?? json.erro ?? 'Erro ao criar trial.')
        return
      }
      onSuccess()
    } catch {
      setErro('Falha de conexão.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-600/30 flex items-center justify-center">
              <Cpu size={14} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Nova Licença Trial</h2>
              <p className="text-[11px] text-slate-500">
                {step === 'cliente' ? 'Passo 1 — Selecione o cliente' : `Passo 2 — Configurar trial · ${nomeCliente(clienteSelecionado!)}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* ── STEP 1: selecionar cliente ── */}
          {step === 'cliente' && (
            <>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Buscar cliente por nome, e-mail..."
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              {buscando && (
                <div className="flex items-center justify-center py-8 gap-2 text-slate-500">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">Buscando...</span>
                </div>
              )}

              {!buscando && busca && clientes.length === 0 && (
                <p className="text-center text-sm text-slate-500 py-8">Nenhum cliente encontrado.</p>
              )}

              {!buscando && clientes.length > 0 && (
                <div className="space-y-1">
                  {clientes.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setClienteSelecionado(c); setStep('form') }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-blue-600/40 transition-colors text-left group"
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
                        <User size={13} className="text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200 font-medium truncate">{nomeCliente(c)}</p>
                        <p className="text-[11px] text-slate-500 truncate">{c.email}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                        c.pj ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'
                      }`}>{c.pj ? 'PJ' : 'PF'}</span>
                    </button>
                  ))}
                </div>
              )}

              {!busca && (
                <p className="text-center text-xs text-slate-600 py-6">
                  Digite o nome ou e-mail do cliente para começar.
                </p>
              )}
            </>
          )}

          {/* ── STEP 2: configurar licença ── */}
          {step === 'form' && (
            <>
              {/* plano */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold">Plano</label>
                <select
                  value={planoId}
                  onChange={e => setPlanoId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  {planos.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nome} — R$ {Number(p.precoMensal).toFixed(2)}/mês
                    </option>
                  ))}
                  {planos.length === 0 && <option value="">Sem planos cadastrados</option>}
                </select>
              </div>

              {/* nome do dispositivo */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold">
                  Nome do Dispositivo <span className="text-slate-600 normal-case font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Ex: PC do João, Notebook Loja"
                  value={nomeDispositivo}
                  onChange={e => setNomeDispositivo(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              {/* HWID */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold">
                  HWID <span className="text-slate-600 normal-case font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Identificador de hardware"
                  value={hwid}
                  onChange={e => setHwid(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono"
                />
              </div>

              {/* dias */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold">Duração do Trial</label>
                <div className="flex gap-2">
                  {DIAS_OPCOES.map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDias(d)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors border ${
                        dias === d
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={!DIAS_OPCOES.includes(dias) ? dias : ''}
                    placeholder="Outro"
                    onChange={e => setDias(Number(e.target.value))}
                    className="flex-1 bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg px-2 py-2.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              </div>

              {erro && (
                <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-sm">
                  <AlertCircle size={14} />
                  {erro}
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between gap-3">
          {step === 'form' ? (
            <button
              onClick={() => { setStep('cliente'); setErro('') }}
              className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              ← Voltar
            </button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            {step === 'form' && (
              <button
                onClick={submeter}
                disabled={enviando}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg transition-colors shadow-lg shadow-blue-900/30"
              >
                {enviando && <Loader2 size={13} className="animate-spin" />}
                Criar Trial
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
