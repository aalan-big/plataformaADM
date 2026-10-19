'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Mail, Search, RefreshCw, Eye, X, Copy, CheckCheck,
  CircleCheck, CircleAlert, MinusCircle, ChevronLeft, ChevronRight,
} from 'lucide-react'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Status = 'ENVIADO' | 'FALHOU' | 'NAO_ENVIADO'

type ItemEmail = {
  id:           string
  tipo:         string
  destinatario: string
  assunto:      string
  status:       Status
  erro:         string | null
  resendId:     string | null
  criadoEm:     string
  nomeCliente:  string | null
}

type DetalheEmail = ItemEmail & { html: string }

type Resumo = { enviados: number; falhas: number; naoEnviados: number; dias: number }

type Resposta = {
  itens:     ItemEmail[]
  total:     number
  pagina:    number
  porPagina: number
  resumo:    Resumo
}

/** Os tipos que o `EmailService` grava (`TipoEmail` no server). */
const TIPOS: Record<string, string> = {
  CHAVE_ATIVACAO:     'Chave de ativação',
  PRIMEIRO_ACESSO:    'Primeiro acesso',
  RENOVACAO:          'Renovação confirmada',
  FALHA_PAGAMENTO:    'Falha no pagamento',
  AVISO_VENCIMENTO:   'Aviso de vencimento',
  RETENCAO_BACKUP:    'Retenção de backup',
  TROCA_COMPUTADOR:   'Troca de computador',
  ALERTA_OPERACIONAL: 'Alerta operacional',
}

const POR_PAGINA = 30

// ─── Helpers ──────────────────────────────────────────────────────────────────

function quando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function BadgeStatus({ status }: { status: Status }) {
  const cfg = {
    ENVIADO:     { label: 'Enviado',     cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', Icone: CircleCheck },
    FALHOU:      { label: 'Falhou',      cls: 'bg-red-500/10 text-red-400 border-red-500/20',             Icone: CircleAlert },
    NAO_ENVIADO: { label: 'Não enviado', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20',       Icone: MinusCircle },
  }[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${cfg.cls}`}>
      <cfg.Icone size={11} /> {cfg.label}
    </span>
  )
}

function BotaoCopiar({ texto, titulo }: { texto: string; titulo: string }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch {}
  }
  return (
    <button onClick={copiar} className="p-1 text-slate-500 hover:text-emerald-400 transition-colors" title={titulo}>
      {copiado ? <CheckCheck size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  )
}

// ─── Modal: o e-mail como o cliente recebeu ───────────────────────────────────

function ModalEmail({ id, onClose }: { id: string; onClose: () => void }) {
  const [email, setEmail] = useState<DetalheEmail | null>(null)
  const [erro, setErro]   = useState('')

  useEffect(() => {
    let vivo = true
    fetch(`/api/email/historico/${id}`)
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!vivo) return
        if (!res.ok) setErro(json.message ?? `Erro ${res.status}.`)
        else setEmail(json)
      })
      .catch(() => vivo && setErro('Falha ao carregar o e-mail.'))
    return () => { vivo = false }
  }, [id])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-3xl bg-[#0f1117] border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-600/15 border border-blue-600/20 flex items-center justify-center shrink-0">
              <Mail size={15} className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-slate-200 font-semibold text-sm truncate">{email?.assunto ?? 'Carregando…'}</p>
              <p className="text-[11px] text-slate-500 truncate">
                {email ? <>Para {email.nomeCliente ? <>{email.nomeCliente} · </> : null}{email.destinatario}</> : ' '}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {erro && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">{erro}</p>}

          {!email && !erro && (
            <div className="flex flex-col items-center gap-3 py-16">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-slate-500 text-xs">Carregando e-mail...</span>
            </div>
          )}

          {email && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Info rotulo="Status"><BadgeStatus status={email.status} /></Info>
                <Info rotulo="Tipo"><span className="text-slate-300 text-[13px]">{TIPOS[email.tipo] ?? email.tipo}</span></Info>
                <Info rotulo="Quando"><span className="text-slate-300 text-[13px]">{quando(email.criadoEm)}</span></Info>
                <Info rotulo="Id no Resend">
                  {email.resendId
                    ? <span className="flex items-center gap-1 min-w-0"><code className="text-[11px] text-slate-400 truncate">{email.resendId}</code><BotaoCopiar texto={email.resendId} titulo="Copiar id do Resend" /></span>
                    : <span className="text-slate-600 text-[13px]">—</span>}
                </Info>
              </div>

              {email.erro && (
                <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <p className="font-semibold text-red-400 mb-0.5">Motivo</p>
                  <p className="break-all">{email.erro}</p>
                </div>
              )}

              <div>
                <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold mb-2">Como o destinatário recebeu</p>
                {/* sandbox sem permissões: o HTML gravado é exibido, nunca executado */}
                <iframe
                  title="Prévia do e-mail"
                  sandbox=""
                  srcDoc={email.html}
                  className="w-full h-140 rounded-xl border border-slate-800 bg-white"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 min-w-0">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{rotulo}</p>
      {children}
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function EmailPage() {
  const [dados, setDados]           = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState('')
  const [busca, setBusca]           = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [status, setStatus]         = useState('')
  const [tipo, setTipo]             = useState('')
  const [pagina, setPagina]         = useState(1)
  const [aberto, setAberto]         = useState<string | null>(null)

  // A busca vai ao servidor (o histórico cresce sem parar), então espera a
  // pessoa parar de digitar em vez de disparar a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => { setBuscaAplicada(busca.trim()); setPagina(1) }, 350)
    return () => clearTimeout(t)
  }, [busca])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    const params = new URLSearchParams({ pagina: String(pagina), porPagina: String(POR_PAGINA) })
    if (status)        params.set('status', status)
    if (tipo)          params.set('tipo', tipo)
    if (buscaAplicada) params.set('q', buscaAplicada)

    try {
      const res  = await fetch(`/api/email/historico?${params}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.message ?? `Erro ${res.status}.`); setDados(null); return }
      setDados(json)
    } catch {
      setErro('Falha ao carregar o histórico de e-mails.')
      setDados(null)
    } finally {
      setCarregando(false)
    }
  }, [pagina, status, tipo, buscaAplicada])

  useEffect(() => { carregar() }, [carregar])

  const total    = dados?.total ?? 0
  const paginas  = Math.max(1, Math.ceil(total / POR_PAGINA))
  const filtrado = !!(buscaAplicada || status || tipo)

  const STATS = [
    { label: 'Enviados',    valor: dados?.resumo.enviados,    cor: 'text-emerald-400' },
    { label: 'Falharam',    valor: dados?.resumo.falhas,      cor: 'text-red-400'     },
    { label: 'Não enviados', valor: dados?.resumo.naoEnviados, cor: 'text-slate-300'   },
  ]

  return (
    <div className="space-y-5">

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-blue-950 border border-slate-800 p-8">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-linear-to-l from-blue-950/60 to-transparent pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-[0.25em] mb-1.5">
              Histórico de envios
            </p>
            <h1 className="text-3xl font-extrabold text-white uppercase tracking-wide">E-mails</h1>
            <p className="text-slate-400 text-[13px] mt-2 max-w-lg">
              Tudo o que a plataforma mandou: para quem, quando e se chegou ao Resend.
              Clique num e-mail para ver como o cliente recebeu.
            </p>
          </div>

          <div className="flex items-stretch gap-3 shrink-0 flex-wrap">
            {STATS.map(s => (
              <div key={s.label} className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-5 py-3 text-center min-w-18">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className={`text-2xl font-extrabold ${s.cor}`}>{s.valor ?? '—'}</p>
              </div>
            ))}
            <p className="w-full text-[10px] text-slate-500 text-right">últimos {dados?.resumo.dias ?? 30} dias</p>
          </div>
        </div>
      </div>

      {/* ── FILTROS ──────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-56 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="E-mail do destinatário ou assunto..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
          />
        </div>

        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPagina(1) }}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          <option value="">Todos os status</option>
          <option value="ENVIADO">Enviados</option>
          <option value="FALHOU">Falharam</option>
          <option value="NAO_ENVIADO">Não enviados</option>
        </select>

        <select
          value={tipo}
          onChange={e => { setTipo(e.target.value); setPagina(1) }}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS).map(([valor, label]) => <option key={valor} value={valor}>{label}</option>)}
        </select>

        <button
          onClick={carregar}
          disabled={carregando}
          className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors shadow-lg shadow-blue-900/30"
        >
          <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {erro && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 flex items-center gap-2">
          <CircleAlert size={13} /> {erro}
        </div>
      )}

      {/* ── TABELA ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Quando</th>
                <th className="text-left px-5 py-3 font-semibold">Destinatário</th>
                <th className="text-left px-5 py-3 font-semibold">Tipo / Assunto</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
                <th className="text-left px-5 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">

              {carregando && !dados && (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-slate-500 text-xs">Carregando e-mails...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!carregando && dados && dados.itens.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2">
                      <Mail size={28} className="text-slate-700" />
                      <p className="text-slate-500 text-sm">
                        {filtrado ? 'Nenhum e-mail encontrado com esses filtros.' : 'Nenhum e-mail registrado ainda.'}
                      </p>
                      {!filtrado && (
                        <p className="text-[11px] text-slate-600 max-w-sm">
                          O histórico começa a contar a partir desta versão. Os e-mails enviados antes dela não foram guardados.
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {dados?.itens.map(e => (
                <tr
                  key={e.id}
                  onClick={() => setAberto(e.id)}
                  className={`hover:bg-slate-800/40 transition-colors cursor-pointer ${carregando ? 'opacity-60' : ''}`}
                >
                  <td className="px-5 py-4 whitespace-nowrap">
                    <p className="text-slate-300 text-[13px]">{quando(e.criadoEm)}</p>
                  </td>

                  <td className="px-5 py-4 max-w-64">
                    <p className="font-medium text-slate-200 leading-tight text-[13px] truncate">{e.nomeCliente ?? e.destinatario}</p>
                    {e.nomeCliente && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{e.destinatario}</p>}
                  </td>

                  <td className="px-5 py-4 max-w-80">
                    <p className="text-[11px] text-blue-400 font-semibold">{TIPOS[e.tipo] ?? e.tipo}</p>
                    <p className="text-slate-300 text-[13px] truncate">{e.assunto}</p>
                  </td>

                  <td className="px-5 py-4">
                    <div className="flex flex-col gap-1 items-start">
                      <BadgeStatus status={e.status} />
                      {e.erro && <p className="text-[10px] text-red-400/80 max-w-56 truncate" title={e.erro}>{e.erro}</p>}
                    </div>
                  </td>

                  <td className="px-5 py-4">
                    <button
                      onClick={ev => { ev.stopPropagation(); setAberto(e.id) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 text-slate-300 hover:border-blue-500/50 hover:text-blue-400 transition-all"
                    >
                      <Eye size={11} />
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── PAGINAÇÃO ──────────────────────────────────────────────────────── */}
        {total > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 text-[12px] text-slate-500">
            <span>
              {(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, total)} de {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPagina(p => Math.max(1, p - 1))}
                disabled={pagina <= 1 || carregando}
                className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:border-blue-500/50 disabled:opacity-40 disabled:hover:border-slate-700 transition-all"
                title="Página anterior"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-slate-400">{pagina} / {paginas}</span>
              <button
                onClick={() => setPagina(p => Math.min(paginas, p + 1))}
                disabled={pagina >= paginas || carregando}
                className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:border-blue-500/50 disabled:opacity-40 disabled:hover:border-slate-700 transition-all"
                title="Próxima página"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {aberto && <ModalEmail id={aberto} onClose={() => setAberto(null)} />}
    </div>
  )
}
