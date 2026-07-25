'use client'

import { useState, useEffect } from 'react'
import {
  Cpu, Check, Loader2, AlertCircle, ShieldCheck, ArrowLeft, Lock,
} from 'lucide-react'

type Opcao = { meses: number; label: string; total: number; desconto: number }

type PlanoPublico = {
  id:            string
  nome:          string
  descricao:     string | null
  limiteUsuario: number
  opcoes:        Opcao[]
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const campo = 'w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/40'

const camposVazios = { nomeOuRazao: '', documento: '', email: '', senha: '', celular: '' }

export default function ContratarPage() {
  const [planos, setPlanos]         = useState<PlanoPublico[]>([])
  const [carregando, setCarregando] = useState(true)

  // Período primeiro, cadastro depois: o cliente só digita dados pessoais
  // depois de decidir o que vai comprar.
  const [etapa, setEtapa]           = useState<'periodo' | 'cadastro'>('periodo')
  const [plano, setPlano]           = useState<PlanoPublico | null>(null)
  const [meses, setMeses]           = useState<number | null>(null)

  const [form, setForm]             = useState(camposVazios)
  const [enviando, setEnviando]     = useState(false)
  const [erro, setErro]             = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch('/api/publico/planos')
        const json = await res.json()
        const lista: PlanoPublico[] = Array.isArray(json.data) ? json.data : []
        setPlanos(lista)
        if (lista.length === 1) {
          setPlano(lista[0])
          setMeses(lista[0].opcoes[0]?.meses ?? null)
        }
      } catch {
        setPlanos([])
      } finally {
        setCarregando(false)
      }
    })()
  }, [])

  const set = (k: keyof typeof camposVazios, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const opcaoEscolhida = plano?.opcoes.find(o => o.meses === meses) ?? null

  const documentoLimpo = form.documento.replace(/\D/g, '')
  const formValido =
    form.nomeOuRazao.trim().length >= 2 &&
    (documentoLimpo.length === 11 || documentoLimpo.length === 14) &&
    /^\S+@\S+\.\S+$/.test(form.email) &&
    form.senha.length >= 8

  async function contratar() {
    if (!plano || !meses) return
    setEnviando(true); setErro('')
    try {
      const res = await fetch('/api/publico/contratar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          planoId:     plano.id,
          meses,
          nomeOuRazao: form.nomeOuRazao.trim(),
          documento:   documentoLimpo,
          email:       form.email.trim().toLowerCase(),
          senha:       form.senha,
          ...(form.celular.trim() ? { celular: form.celular.trim() } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Não foi possível concluir a contratação.')

      // Sai daqui direto para o Stripe.
      window.location.href = json.data.url
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
      setEnviando(false)
    }
  }

  if (carregando) {
    return (
      <div className="flex flex-col items-center gap-3 text-slate-400 py-24">
        <Loader2 size={28} className="animate-spin text-blue-400" />
        <p className="text-sm">Carregando planos...</p>
      </div>
    )
  }

  if (planos.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
        <AlertCircle size={34} className="text-amber-400 mx-auto" />
        <p className="text-white font-semibold">Contratação indisponível no momento</p>
        <p className="text-slate-400 text-sm">
          Nenhum plano está aberto para contratação online. Entre em contato com o suporte.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Cabeçalho */}
      <div className="flex items-center gap-3.5 mb-2">
        <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-600/30 flex items-center justify-center shrink-0">
          <Cpu size={22} className="text-blue-400" />
        </div>
        <div>
          <p className="text-[11px] font-bold text-blue-400 uppercase tracking-[0.2em]">StartBig ERP</p>
          <h1 className="text-xl font-bold text-white">
            {etapa === 'periodo' ? 'Escolha seu plano' : 'Seus dados'}
          </h1>
        </div>
      </div>

      {/* ── Etapa 1: período ─────────────────────────────────────────────────── */}
      {etapa === 'periodo' && (
        <>
          {planos.map(p => (
            <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800">
                <h2 className="text-lg font-bold text-white">{p.nome}</h2>
                <p className="text-xs text-slate-400 mt-1">Até {p.limiteUsuario} usuário{p.limiteUsuario > 1 ? 's' : ''}</p>
                {p.descricao && (
                  <p className="text-xs text-slate-500 leading-relaxed mt-3">{p.descricao}</p>
                )}
              </div>

              <div className="p-5 space-y-2.5">
                {p.opcoes.map(op => {
                  const selecionada = plano?.id === p.id && meses === op.meses
                  return (
                    <button
                      key={op.meses}
                      onClick={() => { setPlano(p); setMeses(op.meses) }}
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
                          <p className={`text-sm font-semibold ${selecionada ? 'text-white' : 'text-slate-300'}`}>{op.label}</p>
                          {op.desconto > 0 && (
                            <p className="text-[11px] text-emerald-400 font-medium">
                              {Math.round(op.desconto * 100)}% de desconto
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-base font-bold ${selecionada ? 'text-white' : 'text-slate-300'}`}>{reais(op.total)}</p>
                        {op.meses > 1 && (
                          <p className="text-[11px] text-slate-500">{reais(op.total / op.meses)}/mês</p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <button
            onClick={() => setEtapa('cadastro')}
            disabled={!opcaoEscolhida}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm"
          >
            Continuar
          </button>

          <p className="text-[11px] text-slate-600 text-center">
            Você ainda não vai pagar nada nesta tela.
          </p>
        </>
      )}

      {/* ── Etapa 2: cadastro ────────────────────────────────────────────────── */}
      {etapa === 'cadastro' && plano && opcaoEscolhida && (
        <>
          <button
            onClick={() => setEtapa('periodo')}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={15} /> Trocar plano
          </button>

          {/* Resumo do que foi escolhido, sempre visível */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-white">{plano.nome} · {opcaoEscolhida.label}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Renova automaticamente a cada {opcaoEscolhida.meses === 1 ? 'mês' : `${opcaoEscolhida.meses} meses`}. Cancele quando quiser.
              </p>
            </div>
            <p className="text-xl font-bold text-white shrink-0 ml-4">{reais(opcaoEscolhida.total)}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Nome ou razão social</label>
              <input className={campo} value={form.nomeOuRazao} onChange={e => set('nomeOuRazao', e.target.value)}
                placeholder="Como você quer ser identificado" autoComplete="name" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">CPF ou CNPJ</label>
                <input className={campo} value={form.documento} onChange={e => set('documento', e.target.value)}
                  placeholder="Somente números" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Celular (opcional)</label>
                <input className={campo} value={form.celular} onChange={e => set('celular', e.target.value)}
                  placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">E-mail</label>
              <input className={campo} type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="seu@email.com" autoComplete="email" />
              <p className="text-[11px] text-slate-500">
                É para onde vai a chave de ativação. Confira com atenção.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Senha de acesso</label>
              <input className={campo} type="password" value={form.senha} onChange={e => set('senha', e.target.value)}
                placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
              <p className="text-[11px] text-slate-500">
                Você vai usar este e-mail e senha para entrar no sistema.
              </p>
            </div>

            {erro && (
              <div className="flex items-start gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-3 text-sm">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{erro}</span>
              </div>
            )}

            <button
              onClick={contratar}
              disabled={enviando || !formValido}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm shadow-lg shadow-blue-900/30"
            >
              {enviando
                ? <><Loader2 size={16} className="animate-spin" /> Preparando pagamento...</>
                : <><Lock size={15} /> Ir para o pagamento</>}
            </button>

            <div className="flex items-center gap-2 text-[11px] text-slate-500 justify-center">
              <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
              Pagamento processado pela Stripe. Seus dados de cartão não passam por nós.
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl px-5 py-4 space-y-2">
            {[
              'Sua conta é criada agora e o acesso já fica liberado',
              'A chave de ativação chega no seu e-mail após o pagamento',
              'Você pode cancelar a assinatura quando quiser',
            ].map(t => (
              <p key={t} className="flex items-start gap-2 text-[11px] text-slate-400">
                <Check size={12} className="text-emerald-400 shrink-0 mt-0.5" /> {t}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
