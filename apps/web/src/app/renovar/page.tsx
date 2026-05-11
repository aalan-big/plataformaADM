'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Cpu, CheckCircle2, AlertCircle, Loader2, ShieldCheck, Calendar, Zap } from 'lucide-react'

type Opcao = {
  meses:    number
  label:    string
  total:    number
  desconto: number
}

type PlanoPagamento = {
  licencaId:      string
  cliente:        { nome: string; email: string }
  plano:          string
  status:         string
  dataVencimento: string | null
  opcoes:         Opcao[]
}

function formatarData(iso: string) {
  const d = new Date(iso)
  const m = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${d.getDate().toString().padStart(2,'0')} ${m[d.getMonth()]} ${d.getFullYear()}`
}

function formatarReais(valor: number) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function RenovarPage() {
  const params    = useSearchParams()
  const licencaId = params.get('licencaId')

  const [dados,        setDados]        = useState<PlanoPagamento | null>(null)
  const [carregando,   setCarregando]   = useState(true)
  const [erro,         setErro]         = useState('')
  const [opcaoSelecionada, setOpcao]    = useState<number>(1)
  const [processando,  setProcessando]  = useState(false)
  const [erroCobranca, setErroCobranca] = useState('')

  const carregar = useCallback(async () => {
    if (!licencaId) { setErro('Link inválido. Verifique se o endereço está correto.'); setCarregando(false); return }
    try {
      const res  = await fetch(`/api/financeiro/plano-pagamento/${licencaId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? 'Erro ao carregar dados.')
      setDados(json.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar dados.')
    } finally {
      setCarregando(false)
    }
  }, [licencaId])

  useEffect(() => { carregar() }, [carregar])

  async function pagar() {
    if (!dados) return
    setProcessando(true)
    setErroCobranca('')
    try {
      const res  = await fetch('/api/financeiro/gerar-cobranca', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ licencaId: dados.licencaId, meses: opcaoSelecionada }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Erro ao gerar cobrança.')
      window.location.href = json.url
    } catch (e) {
      setErroCobranca(e instanceof Error ? e.message : 'Erro ao iniciar pagamento.')
    } finally {
      setProcessando(false)
    }
  }

  if (carregando) {
    return (
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <Loader2 size={28} className="animate-spin text-blue-400" />
        <p className="text-sm">Carregando dados...</p>
      </div>
    )
  }

  if (erro) {
    return (
      <div className="w-full max-w-md bg-slate-900 border border-red-500/20 rounded-2xl p-8 text-center space-y-3">
        <AlertCircle size={36} className="text-red-400 mx-auto" />
        <p className="text-white font-semibold">Link inválido</p>
        <p className="text-slate-400 text-sm">{erro}</p>
      </div>
    )
  }

  if (!dados) return null

  const opcao = dados.opcoes.find(o => o.meses === opcaoSelecionada)

  return (
    <div className="w-full max-w-lg space-y-4">

      {/* Header do produto */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
        <div className="relative bg-linear-to-br from-slate-800 to-blue-950/60 px-6 py-5">
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '18px 18px' }}
          />
          <div className="relative flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-600/30 flex items-center justify-center shrink-0">
              <Cpu size={22} className="text-blue-400" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">Renovação de Licença</p>
              <h1 className="text-lg font-bold text-white">{dados.plano}</h1>
              <p className="text-sm text-slate-400">{dados.cliente.nome}</p>
            </div>
          </div>
        </div>

        {dados.dataVencimento && (
          <div className="px-6 py-3 border-t border-slate-800 flex items-center gap-2">
            <Calendar size={13} className="text-slate-500" />
            <p className="text-xs text-slate-400">
              Vencimento atual:{' '}
              <span className="text-slate-300 font-medium">{formatarData(dados.dataVencimento)}</span>
            </p>
          </div>
        )}
      </div>

      {/* Opções de plano */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Escolha o período</p>

        {dados.opcoes.map(op => {
          const selecionada = opcaoSelecionada === op.meses
          return (
            <button
              key={op.meses}
              onClick={() => setOpcao(op.meses)}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all ${
                selecionada
                  ? 'bg-blue-600/15 border-blue-500/50 ring-1 ring-blue-500/30'
                  : 'bg-slate-800/40 border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  selecionada ? 'border-blue-400' : 'border-slate-600'
                }`}>
                  {selecionada && <div className="w-2 h-2 rounded-full bg-blue-400" />}
                </div>
                <div className="text-left">
                  <p className={`text-sm font-semibold ${selecionada ? 'text-white' : 'text-slate-300'}`}>
                    {op.label}
                  </p>
                  {op.desconto > 0 && (
                    <p className="text-[11px] text-emerald-400 font-medium">
                      {Math.round(op.desconto * 100)}% de desconto
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className={`text-base font-bold ${selecionada ? 'text-white' : 'text-slate-300'}`}>
                  {formatarReais(op.total)}
                </p>
                {op.meses > 1 && (
                  <p className="text-[11px] text-slate-500">
                    {formatarReais(op.total / op.meses)}/mês
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Resumo + botão */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4">
        {opcao && (
          <div className="flex items-center justify-between text-sm pb-4 border-b border-slate-800">
            <span className="text-slate-400">Total a pagar</span>
            <span className="text-xl font-bold text-white">{formatarReais(opcao.total)}</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
          Pagamento seguro via Asaas — PIX, Boleto ou Cartão
        </div>

        {erroCobranca && (
          <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-sm">
            <AlertCircle size={14} className="shrink-0" />
            {erroCobranca}
          </div>
        )}

        <button
          onClick={pagar}
          disabled={processando}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm shadow-lg shadow-blue-900/30"
        >
          {processando
            ? <><Loader2 size={16} className="animate-spin" /> Aguarde...</>
            : <><Zap size={16} /> Pagar agora</>
          }
        </button>

        <p className="text-[11px] text-slate-600 text-center">
          Após o pagamento, você receberá a chave de ativação no e-mail <span className="text-slate-500">{dados.cliente.email}</span>
        </p>
      </div>

    </div>
  )
}
