'use client'

import { useState, useEffect } from 'react'
import { Check, Loader2, AlertCircle, ShieldCheck, ArrowLeft, Lock } from 'lucide-react'
import { LogoStartBig, BadgeSecao } from './_components/Marca'

type Opcao = { meses: number; label: string; total: number; desconto: number }

type PlanoPublico = {
  id:            string
  nome:          string
  descricao:     string | null
  limiteUsuario: number
  opcoes:        Opcao[]
}

const SITE = 'https://startbig.com.br'

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Tokens do site: borda #E9E9E9, texto #334155, foco no azul da marca.
const campo =
  'w-full bg-white border border-[#E9E9E9] text-[#151515] placeholder-[#94A3B8] text-sm rounded-xl px-4 py-3 ' +
  'focus:outline-none focus:border-[#045CA1] focus:ring-4 focus:ring-[#045CA1]/10 transition-colors'

const rotulo = 'block text-sm font-semibold text-[#151515] mb-1.5'

const botaoPrimario =
  'w-full flex items-center justify-center gap-2 bg-[#045CA1] hover:bg-[#034A82] disabled:bg-[#94A3B8] ' +
  'disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors'

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

      window.location.href = json.data.url
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
      setEnviando(false)
    }
  }

  return (
    <>
      {/* ── Cabeçalho, no mesmo formato do site ──────────────────────────────── */}
      <header className="border-b border-[#E9E9E9] bg-white">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
          <LogoStartBig />
          <a href={SITE} className="text-sm font-medium text-[#64748B] hover:text-[#045CA1] transition-colors">
            Voltar ao site
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-10 sm:py-14">
        {carregando ? (
          <div className="flex flex-col items-center gap-3 text-[#64748B] py-24">
            <Loader2 size={28} className="animate-spin text-[#045CA1]" />
            <p className="text-sm">Carregando planos...</p>
          </div>
        ) : planos.length === 0 ? (
          <div className="bg-white border border-[#E9E9E9] rounded-2xl p-10 text-center space-y-3 shadow-sm">
            <AlertCircle size={34} className="text-[#B45309] mx-auto" />
            <p className="text-[#151515] font-bold text-lg">Contratação indisponível no momento</p>
            <p className="text-[#64748B] text-sm max-w-md mx-auto">
              Nenhum plano está aberto para contratação online. Fale com a gente pelo site que a gente resolve.
            </p>
            <a href={SITE} className="inline-block text-sm font-semibold text-[#045CA1] hover:text-[#034A82]">
              Ir para o site
            </a>
          </div>
        ) : (
          <div className="space-y-6">

            {/* ── Etapa 1: período ───────────────────────────────────────────── */}
            {etapa === 'periodo' && (
              <>
                <div className="text-center space-y-3">
                  <BadgeSecao>Contratação</BadgeSecao>
                  <h1 className="text-3xl sm:text-4xl font-extrabold text-[#151515] tracking-tight">
                    Escolha o seu plano
                  </h1>
                  <p className="text-[#64748B] text-sm max-w-lg mx-auto">
                    Todos os períodos incluem os 14 dias de trial. Você não paga nada nesta tela.
                  </p>
                </div>

                {planos.map(p => (
                  <div key={p.id} className="bg-white border border-[#E9E9E9] rounded-2xl overflow-hidden shadow-sm">
                    <div className="px-6 py-5 border-b border-[#E9E9E9] bg-[#F8F7FF]">
                      <h2 className="text-xl font-extrabold text-[#151515]">{p.nome}</h2>
                      <p className="text-xs text-[#64748B] mt-1">
                        Até {p.limiteUsuario} usuário{p.limiteUsuario > 1 ? 's' : ''}
                      </p>
                      {p.descricao && (
                        <p className="text-sm text-[#334155] leading-relaxed mt-3">{p.descricao}</p>
                      )}
                    </div>

                    <div className="p-5 space-y-3">
                      {p.opcoes.map(op => {
                        const selecionada = plano?.id === p.id && meses === op.meses
                        return (
                          <button
                            key={op.meses}
                            onClick={() => { setPlano(p); setMeses(op.meses) }}
                            className={`w-full flex items-center justify-between px-4 py-4 rounded-xl border-2 transition-all ${
                              selecionada
                                ? 'border-[#045CA1] bg-[#E7F1FA]'
                                : 'border-[#E9E9E9] bg-white hover:border-[#5590BF]'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                selecionada ? 'border-[#045CA1]' : 'border-[#CBD5E1]'
                              }`}>
                                {selecionada && <span className="w-2.5 h-2.5 rounded-full bg-[#045CA1]" />}
                              </span>
                              <span className="text-left">
                                <span className="block text-sm font-bold text-[#151515]">{op.label}</span>
                                {op.desconto > 0 && (
                                  <span className="block text-xs font-semibold text-[#10B981]">
                                    {Math.round(op.desconto * 100)}% de desconto
                                  </span>
                                )}
                              </span>
                            </div>
                            <span className="text-right">
                              <span className="block text-lg font-extrabold text-[#151515]">{reais(op.total)}</span>
                              {op.meses > 1 && (
                                <span className="block text-xs text-[#64748B]">{reais(op.total / op.meses)}/mês</span>
                              )}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                <button onClick={() => setEtapa('cadastro')} disabled={!opcaoEscolhida} className={botaoPrimario}>
                  Continuar
                </button>
              </>
            )}

            {/* ── Etapa 2: cadastro ──────────────────────────────────────────── */}
            {etapa === 'cadastro' && plano && opcaoEscolhida && (
              <>
                <button
                  onClick={() => setEtapa('periodo')}
                  className="flex items-center gap-2 text-sm font-medium text-[#64748B] hover:text-[#045CA1] transition-colors"
                >
                  <ArrowLeft size={15} /> Trocar plano
                </button>

                {/* Resumo do que foi escolhido, sempre visível */}
                <div className="flex items-center justify-between bg-[#F8F7FF] border border-[#E9E9E9] rounded-2xl px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#151515]">{plano.nome} · {opcaoEscolhida.label}</p>
                    <p className="text-xs text-[#64748B] mt-0.5">
                      Renova automaticamente a cada {opcaoEscolhida.meses === 1 ? 'mês' : `${opcaoEscolhida.meses} meses`}. Cancele quando quiser.
                    </p>
                  </div>
                  <p className="text-xl font-extrabold text-[#151515] shrink-0 ml-4">{reais(opcaoEscolhida.total)}</p>
                </div>

                <div className="bg-white border border-[#E9E9E9] rounded-2xl p-6 sm:p-7 space-y-5 shadow-sm">
                  <div>
                    <h2 className="text-xl font-extrabold text-[#151515]">Seus dados</h2>
                    <p className="text-sm text-[#64748B] mt-1">
                      É com este e-mail e senha que você vai entrar no sistema.
                    </p>
                  </div>

                  <div>
                    <label className={rotulo}>Nome ou razão social</label>
                    <input className={campo} value={form.nomeOuRazao} onChange={e => set('nomeOuRazao', e.target.value)}
                      placeholder="Como você quer ser identificado" autoComplete="name" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={rotulo}>CPF ou CNPJ</label>
                      <input className={campo} value={form.documento} onChange={e => set('documento', e.target.value)}
                        placeholder="Somente números" inputMode="numeric" />
                    </div>
                    <div>
                      <label className={rotulo}>Celular <span className="font-normal text-[#94A3B8]">(opcional)</span></label>
                      <input className={campo} value={form.celular} onChange={e => set('celular', e.target.value)}
                        placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" />
                    </div>
                  </div>

                  <div>
                    <label className={rotulo}>E-mail</label>
                    <input className={campo} type="email" value={form.email} onChange={e => set('email', e.target.value)}
                      placeholder="seu@email.com" autoComplete="email" />
                    <p className="text-xs text-[#64748B] mt-1.5">
                      É para onde vai a chave de ativação. Confira com atenção.
                    </p>
                  </div>

                  <div>
                    <label className={rotulo}>Senha de acesso</label>
                    <input className={campo} type="password" value={form.senha} onChange={e => set('senha', e.target.value)}
                      placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
                  </div>

                  {erro && (
                    <div className="flex items-start gap-2.5 text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-4 py-3 text-sm">
                      <AlertCircle size={15} className="shrink-0 mt-0.5" />
                      <span>{erro}</span>
                    </div>
                  )}

                  <button onClick={contratar} disabled={enviando || !formValido} className={botaoPrimario}>
                    {enviando
                      ? <><Loader2 size={16} className="animate-spin" /> Preparando pagamento...</>
                      : <><Lock size={15} /> Ir para o pagamento</>}
                  </button>

                  <p className="flex items-center justify-center gap-2 text-xs text-[#64748B]">
                    <ShieldCheck size={13} className="text-[#10B981] shrink-0" />
                    Pagamento processado pela Stripe. Seus dados de cartão não passam por nós.
                  </p>
                </div>

                <div className="bg-[#F8F7FF] border border-[#E9E9E9] rounded-2xl px-6 py-5 space-y-2.5">
                  {[
                    'Sua conta é criada agora e o acesso já fica liberado',
                    'A chave de ativação chega no seu e-mail após o pagamento',
                    'Você pode cancelar a assinatura quando quiser',
                  ].map(t => (
                    <p key={t} className="flex items-start gap-2.5 text-sm text-[#334155]">
                      <Check size={15} className="text-[#10B981] shrink-0 mt-0.5" /> {t}
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-[#E9E9E9] mt-8">
        <div className="max-w-3xl mx-auto px-5 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-[#64748B]">© 2026 StartBIG · Desenvolvido por BIG TEC</p>
          <div className="flex items-center gap-5 text-xs">
            <a href={`${SITE}/politica-de-privacidade`} className="text-[#64748B] hover:text-[#045CA1] transition-colors">
              Política de Privacidade
            </a>
            <a href={`${SITE}/termos-de-uso`} className="text-[#64748B] hover:text-[#045CA1] transition-colors">
              Termos de Uso
            </a>
          </div>
        </div>
      </footer>
    </>
  )
}
