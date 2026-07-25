'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Loader2, AlertCircle, ShieldCheck, ArrowLeft, Lock, UserCheck } from 'lucide-react'
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

const camposVazios = { nomeOuRazao: '', documento: '', senha: '', celular: '' }

/**
 * Endereço completo e estruturado — exigência de nota fiscal. O do Stripe não
 * serve para emissão automática: o formato dele é internacional e não tem campo
 * separado de bairro nem de número, que as prefeituras pedem.
 */
const enderecoVazio = {
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
}

/**
 * Resumo do que foi escolhido, repetido em todas as etapas depois da escolha.
 * Ninguém deve chegar no cartão sem ter o valor à vista o tempo todo.
 */
function Resumo({ plano, opcao }: { plano: string; opcao: Opcao }) {
  return (
    <div className="flex items-center justify-between bg-[#F8F7FF] border border-[#E9E9E9] rounded-2xl px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-[#151515]">{plano} · {opcao.label}</p>
        <p className="text-xs text-[#64748B] mt-0.5">
          Renova automaticamente a cada {opcao.meses === 1 ? 'mês' : `${opcao.meses} meses`}. Cancele quando quiser.
        </p>
      </div>
      <p className="text-xl font-extrabold text-[#151515] shrink-0 ml-4">
        {opcao.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </p>
    </div>
  )
}

function Erro({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2.5 text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-4 py-3 text-sm">
      <AlertCircle size={15} className="shrink-0 mt-0.5" />
      <span>{texto}</span>
    </div>
  )
}

function ContratarConteudo() {
  const params = useSearchParams()

  const [planos, setPlanos]         = useState<PlanoPublico[]>([])
  const [carregando, setCarregando] = useState(true)

  // Período → identificação por e-mail → o formulário se adapta ao que a
  // identificação descobrir. O cliente só digita dados pessoais depois de
  // decidir o que vai comprar, e quem já é cliente não redigita nada.
  const [etapa, setEtapa]           = useState<'periodo' | 'email' | 'cadastro' | 'senha'>('periodo')
  const [plano, setPlano]           = useState<PlanoPublico | null>(null)
  const [meses, setMeses]           = useState<number | null>(null)

  // O ERP manda o cliente para cá já com o e-mail dele na URL
  // (?email=...), então ele não redigita o que o sistema já sabe.
  const emailDoLink = params.get('email') ?? ''
  const [email, setEmail]           = useState(emailDoLink)
  const [senha, setSenha]           = useState('')
  const [verificando, setVerificando] = useState(false)

  const [form, setForm]             = useState(camposVazios)
  const [endereco, setEndereco]     = useState(enderecoVazio)
  const [buscandoCep, setBuscandoCep] = useState(false)
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

  const setEnd = (k: keyof typeof enderecoVazio, v: string) => setEndereco(prev => ({ ...prev, [k]: v }))

  /**
   * Preenche o endereço a partir do CEP. Os campos continuam editáveis: CEP de
   * cidade pequena às vezes não traz logradouro, e o cliente precisa poder
   * completar na mão em vez de travar.
   */
  async function buscarCep(valor: string) {
    const digitos = valor.replace(/\D/g, '')
    if (digitos.length !== 8) return
    setBuscandoCep(true)
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${digitos}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setEndereco(prev => ({
          ...prev,
          logradouro: data.logradouro || prev.logradouro,
          bairro:     data.bairro     || prev.bairro,
          cidade:     data.localidade || prev.cidade,
          estado:     data.uf         || prev.estado,
        }))
      }
    } catch { /* ViaCEP fora do ar não pode impedir a compra — digita na mão */ }
    finally { setBuscandoCep(false) }
  }

  const documentoLimpo = form.documento.replace(/\D/g, '')
  const emailValido    = /^\S+@\S+\.\S+$/.test(email)

  // Endereço obrigatório porque é dado de nota fiscal — sem ele a emissão trava
  // depois, com o dinheiro já recebido e o cliente sem o documento.
  const enderecoValido =
    endereco.cep.replace(/\D/g, '').length === 8 &&
    endereco.logradouro.trim().length >= 3 &&
    endereco.numero.trim().length >= 1 &&
    endereco.bairro.trim().length >= 2 &&
    endereco.cidade.trim().length >= 2 &&
    endereco.estado.trim().length === 2

  const formValido =
    form.nomeOuRazao.trim().length >= 2 &&
    (documentoLimpo.length === 11 || documentoLimpo.length === 14) &&
    form.senha.length >= 8 &&
    enderecoValido

  /** Descobre se o e-mail já tem conta e manda para o caminho certo. */
  async function identificar() {
    setVerificando(true); setErro('')
    try {
      const res = await fetch('/api/publico/identificar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Não foi possível verificar o e-mail.')

      if (json.data.precisaCriarSenha) {
        setErro('Sua conta ainda não tem senha definida. Verifique seu e-mail para criar uma, ou fale com o suporte.')
        return
      }

      setEtapa(json.data.existe ? 'senha' : 'cadastro')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setVerificando(false)
    }
  }

  /** Envia para o endpoint certo conforme o cliente seja novo ou já existente. */
  async function enviar(tipo: 'novo' | 'existente') {
    if (!plano || !meses) return
    setEnviando(true); setErro('')
    try {
      const rota = tipo === 'novo' ? '/api/publico/contratar' : '/api/publico/contratar-existente'
      const corpo = tipo === 'novo'
        ? {
            planoId: plano.id, meses,
            nomeOuRazao: form.nomeOuRazao.trim(),
            documento:   documentoLimpo,
            email:       email.trim().toLowerCase(),
            senha:       form.senha,
            ...(form.celular.trim() ? { celular: form.celular.trim() } : {}),
            endereco: {
              cep:        endereco.cep.replace(/\D/g, ''),
              logradouro: endereco.logradouro.trim(),
              numero:     endereco.numero.trim(),
              bairro:     endereco.bairro.trim(),
              cidade:     endereco.cidade.trim(),
              estado:     endereco.estado.trim().toUpperCase(),
              ...(endereco.complemento.trim() ? { complemento: endereco.complemento.trim() } : {}),
            },
          }
        : { planoId: plano.id, meses, email: email.trim().toLowerCase(), senha }

      const res  = await fetch(rota, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(corpo),
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
                    Serve tanto para quem está começando agora quanto para quem já usa o StartBIG.
                    Você não paga nada nesta tela.
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

                <button onClick={() => setEtapa('email')} disabled={!opcaoEscolhida} className={botaoPrimario}>
                  Continuar
                </button>
              </>
            )}

            {/* ── Etapa 2: identificação por e-mail ──────────────────────────── */}
            {etapa === 'email' && plano && opcaoEscolhida && (
              <>
                <button onClick={() => { setEtapa('periodo'); setErro('') }}
                  className="flex items-center gap-2 text-sm font-medium text-[#64748B] hover:text-[#045CA1] transition-colors">
                  <ArrowLeft size={15} /> Trocar plano
                </button>

                <Resumo plano={plano.nome} opcao={opcaoEscolhida} />

                <div className="bg-white border border-[#E9E9E9] rounded-2xl p-6 sm:p-7 space-y-5 shadow-sm">
                  <div>
                    <h2 className="text-xl font-extrabold text-[#151515]">Qual o seu e-mail?</h2>
                    <p className="text-sm text-[#64748B] mt-1">
                      Serve para os dois casos — a gente descobre qual é o seu no próximo passo.
                    </p>
                  </div>

                  {/* Informação, não escolha. Caixa com borda e fundo pede clique, e
                      clicar aqui não deve decidir nada: quem se acha novo pode já ter
                      cadastro esquecido, e quem se acha cliente pode não ter conta.
                      É a verificação do e-mail que sabe a verdade — estes dois textos
                      só existem para ninguém achar que a página não é para ele. */}
                  <div className="space-y-2">
                    <p className="flex items-start gap-2.5 text-sm text-[#334155]">
                      <Check size={15} className="text-[#10B981] shrink-0 mt-0.5" />
                      <span><strong className="text-[#151515]">Ainda não é cliente?</strong> Criamos sua conta na próxima tela, em menos de um minuto.</span>
                    </p>
                    <p className="flex items-start gap-2.5 text-sm text-[#334155]">
                      <Check size={15} className="text-[#10B981] shrink-0 mt-0.5" />
                      <span><strong className="text-[#151515]">Já usa o StartBIG?</strong> Reconhecemos sua conta e pedimos só a senha.</span>
                    </p>
                  </div>

                  <div>
                    <label className={rotulo}>E-mail</label>
                    <input
                      className={campo} type="email" value={email} autoFocus autoComplete="email"
                      placeholder="seu@email.com"
                      onChange={e => { setEmail(e.target.value); setErro('') }}
                      onKeyDown={e => { if (e.key === 'Enter' && emailValido) identificar() }}
                    />
                    {emailDoLink && email === emailDoLink && (
                      <p className="flex items-center gap-1.5 text-xs text-[#045CA1] mt-1.5">
                        <UserCheck size={12} className="shrink-0" />
                        Preenchemos com o e-mail da sua licença. Pode trocar, se quiser.
                      </p>
                    )}
                  </div>

                  {erro && <Erro texto={erro} />}

                  <button onClick={identificar} disabled={verificando || !emailValido} className={botaoPrimario}>
                    {verificando ? <><Loader2 size={16} className="animate-spin" /> Verificando...</> : 'Continuar'}
                  </button>
                </div>
              </>
            )}

            {/* ── Etapa 3b: já é cliente, só a senha ─────────────────────────── */}
            {etapa === 'senha' && plano && opcaoEscolhida && (
              <>
                <button onClick={() => { setEtapa('email'); setSenha(''); setErro('') }}
                  className="flex items-center gap-2 text-sm font-medium text-[#64748B] hover:text-[#045CA1] transition-colors">
                  <ArrowLeft size={15} /> Usar outro e-mail
                </button>

                <Resumo plano={plano.nome} opcao={opcaoEscolhida} />

                <div className="bg-white border border-[#E9E9E9] rounded-2xl p-6 sm:p-7 space-y-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <UserCheck size={20} className="text-[#045CA1] shrink-0 mt-0.5" />
                    <div>
                      <h2 className="text-xl font-extrabold text-[#151515]">Bem-vindo de volta</h2>
                      <p className="text-sm text-[#64748B] mt-1">
                        Já temos sua conta em <strong className="text-[#151515]">{email}</strong>. Confirme a senha e
                        seguimos direto para o pagamento.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className={rotulo}>Senha</label>
                    <input
                      className={campo} type="password" value={senha} autoFocus autoComplete="current-password"
                      placeholder="Sua senha de acesso"
                      onChange={e => { setSenha(e.target.value); setErro('') }}
                      onKeyDown={e => { if (e.key === 'Enter' && senha) enviar('existente') }}
                    />
                  </div>

                  {erro && <Erro texto={erro} />}

                  <button onClick={() => enviar('existente')} disabled={enviando || !senha} className={botaoPrimario}>
                    {enviando
                      ? <><Loader2 size={16} className="animate-spin" /> Preparando pagamento...</>
                      : <><Lock size={15} /> Ir para o pagamento</>}
                  </button>

                  <p className="flex items-center justify-center gap-2 text-xs text-[#64748B]">
                    <ShieldCheck size={13} className="text-[#10B981] shrink-0" />
                    Pagamento processado pela Stripe. Seus dados de cartão não passam por nós.
                  </p>
                </div>
              </>
            )}

            {/* ── Etapa 2: cadastro ──────────────────────────────────────────── */}
            {etapa === 'cadastro' && plano && opcaoEscolhida && (
              <>
                <button
                  onClick={() => { setEtapa('email'); setErro('') }}
                  className="flex items-center gap-2 text-sm font-medium text-[#64748B] hover:text-[#045CA1] transition-colors"
                >
                  <ArrowLeft size={15} /> Usar outro e-mail
                </button>

                <Resumo plano={plano.nome} opcao={opcaoEscolhida} />

                <div className="bg-white border border-[#E9E9E9] rounded-2xl p-6 sm:p-7 space-y-5 shadow-sm">
                  <div>
                    <h2 className="text-xl font-extrabold text-[#151515]">Crie sua conta</h2>
                    <p className="text-sm text-[#64748B] mt-1">
                      Vamos usar <strong className="text-[#151515]">{email}</strong> como seu acesso ao sistema.
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
                    <label className={rotulo}>Crie uma senha</label>
                    <input className={campo} type="password" value={form.senha} onChange={e => set('senha', e.target.value)}
                      placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
                    <p className="text-xs text-[#64748B] mt-1.5">
                      É com ela e o e-mail acima que você entra no sistema.
                    </p>
                  </div>

                  {/* ── Endereço, para a nota fiscal ── */}
                  <div className="pt-5 border-t border-[#E9E9E9] space-y-4">
                    <div>
                      <h3 className="text-base font-bold text-[#151515]">Endereço</h3>
                      <p className="text-xs text-[#64748B] mt-0.5">
                        Usamos para emitir sua nota fiscal. Digite o CEP que o resto preenche sozinho.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className={rotulo}>CEP</label>
                        <div className="relative">
                          <input
                            className={campo} value={endereco.cep} inputMode="numeric" maxLength={9}
                            placeholder="00000-000"
                            onChange={e => { setEnd('cep', e.target.value); buscarCep(e.target.value) }}
                            onBlur={e => buscarCep(e.target.value)}
                          />
                          {buscandoCep && (
                            <Loader2 size={14} className="animate-spin text-[#64748B] absolute right-3 top-1/2 -translate-y-1/2" />
                          )}
                        </div>
                      </div>
                      <div className="sm:col-span-2">
                        <label className={rotulo}>Rua / logradouro</label>
                        <input className={campo} value={endereco.logradouro}
                          onChange={e => setEnd('logradouro', e.target.value)} autoComplete="address-line1" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className={rotulo}>Número</label>
                        <input className={campo} value={endereco.numero} inputMode="numeric"
                          onChange={e => setEnd('numero', e.target.value)} />
                      </div>
                      <div>
                        <label className={rotulo}>
                          Complemento <span className="font-normal text-[#94A3B8]">(opcional)</span>
                        </label>
                        <input className={campo} value={endereco.complemento} placeholder="Sala, andar..."
                          onChange={e => setEnd('complemento', e.target.value)} />
                      </div>
                      <div>
                        <label className={rotulo}>Bairro</label>
                        <input className={campo} value={endereco.bairro}
                          onChange={e => setEnd('bairro', e.target.value)} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <label className={rotulo}>Cidade</label>
                        <input className={campo} value={endereco.cidade}
                          onChange={e => setEnd('cidade', e.target.value)} autoComplete="address-level2" />
                      </div>
                      <div>
                        <label className={rotulo}>UF</label>
                        <input className={`${campo} uppercase`} value={endereco.estado} maxLength={2} placeholder="CE"
                          onChange={e => setEnd('estado', e.target.value.toUpperCase())} autoComplete="address-level1" />
                      </div>
                    </div>
                  </div>

                  {erro && <Erro texto={erro} />}

                  <button onClick={() => enviar('novo')} disabled={enviando || !formValido} className={botaoPrimario}>
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

      {/*
        Quando as páginas de Política de Privacidade e Termos de Uso existirem no
        site, elas entram aqui. Link legal ausente numa tela de pagamento é menos
        ruim que link legal quebrado — mas as duas páginas são esperadas por quem
        compra e pelo próprio Stripe, então isso é pendência, não decisão.
      */}
      <footer className="border-t border-[#E9E9E9] mt-8">
        <div className="max-w-3xl mx-auto px-5 py-6 text-center">
          <p className="text-xs text-[#64748B]">© 2026 StartBIG · Desenvolvido por BIG TEC</p>
        </div>
      </footer>
    </>
  )
}

/**
 * O conteúdo lê `?email=` da URL, então precisa de Suspense para o Next
 * conseguir renderizar a casca antes de conhecer os parâmetros.
 */
export default function ContratarPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center gap-3 text-[#64748B] py-24">
          <Loader2 size={28} className="animate-spin text-[#045CA1]" />
          <p className="text-sm">Carregando...</p>
        </div>
      }
    >
      <ContratarConteudo />
    </Suspense>
  )
}
