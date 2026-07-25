'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Layers, Plus, Pencil, RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, Power, PowerOff, Users, CreditCard,
} from 'lucide-react'
import { ModalPlano } from './_components/ModalPlano'
import {
  type Plano, PERIODOS, precoDoPeriodo, priceIdDoPeriodo,
  periodosPendentes, formatarReais,
} from './_tipos'

type Aviso = { tipo: 'ok' | 'erro'; texto: string }

export default function PlanosPage() {
  const [planos, setPlanos]         = useState<Plano[]>([])
  const [carregando, setCarregando] = useState(true)
  const [modalAberto, setModal]     = useState(false)
  const [editando, setEditando]     = useState<Plano | null>(null)
  const [ocupadoId, setOcupadoId]   = useState<string | null>(null)
  const [avisos, setAvisos]         = useState<Record<string, Aviso>>({})

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const res  = await fetch('/api/plano')
      const json = await res.json()
      setPlanos(Array.isArray(json.data) ? json.data : [])
    } catch {
      setPlanos([])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const avisar = (id: string, aviso: Aviso) => setAvisos(prev => ({ ...prev, [id]: aviso }))

  /**
   * Leva os valores cadastrados aqui para o catálogo do Stripe e regrava os Price IDs.
   * Sem isso, mudar o preço nesta tela altera só o valor exibido ao cliente: o Stripe
   * continua cobrando o Price antigo, porque Price lá é imutável.
   */
  async function sincronizar(p: Plano) {
    const ok = window.confirm(
      `Sincronizar "${p.nome}" com o Stripe?\n\n` +
      `Os preços e a descrição cadastrados aqui passam a valer para quem assinar a partir de agora.\n\n` +
      `Assinaturas já existentes não mudam de valor — quem contratou continua no preço que contratou.`,
    )
    if (!ok) return

    setOcupadoId(p.id)
    try {
      const res  = await fetch(`/api/plano/${p.id}/sincronizar-stripe`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Falha ao sincronizar.')

      const modo = json.data?.modo === 'LIVE' ? 'LIVE — dinheiro real' : 'TEST'
      const criados = (json.data?.resultados ?? []).filter((r: { acao: string }) => r.acao === 'criado').length
      avisar(p.id, {
        tipo:  'ok',
        texto: `Catálogo sincronizado em ${modo}. ${criados > 0 ? `${criados} preço(s) novo(s) criado(s).` : 'Nenhum preço novo — já estava em dia.'}`,
      })
      await carregar()
    } catch (e) {
      avisar(p.id, { tipo: 'erro', texto: e instanceof Error ? e.message : 'Erro desconhecido' })
    } finally {
      setOcupadoId(null)
    }
  }

  async function alternarStatus(p: Plano) {
    const desativando = p.status === 'ATIVO'
    setOcupadoId(p.id)
    try {
      const res  = await fetch(`/api/plano/${p.id}/${desativando ? 'desativar' : 'reativar'}`, { method: 'PATCH' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Falha na operação.')
      avisar(p.id, { tipo: 'ok', texto: json.msg ?? 'Feito.' })
      await carregar()
    } catch (e) {
      avisar(p.id, { tipo: 'erro', texto: e instanceof Error ? e.message : 'Erro desconhecido' })
    } finally {
      setOcupadoId(null)
    }
  }

  const ativos          = planos.filter(p => p.status === 'ATIVO').length
  const licencasTotais  = planos.reduce((s, p) => s + (p._count?.licencas ?? 0), 0)
  const comPendencia    = planos.filter(p => periodosPendentes(p).length > 0).length

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
              Catálogo de Assinaturas
            </p>
            <h1 className="text-3xl font-extrabold text-white uppercase tracking-wide">Planos</h1>
          </div>

          <div className="flex items-stretch gap-3 shrink-0 flex-wrap">
            <div className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-6 py-4 text-center min-w-25">
              <p className="text-2xl font-extrabold text-white">{ativos}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">Ativos</p>
            </div>
            <div className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-6 py-4 text-center min-w-25">
              <p className="text-2xl font-extrabold text-white">{licencasTotais}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">Licenças</p>
            </div>
            <button
              onClick={() => { setEditando(null); setModal(true) }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-5 rounded-xl transition-colors"
            >
              <Plus size={16} /> Novo plano
            </button>
          </div>
        </div>
      </div>

      {/* ── Aviso global de catálogo desalinhado ─────────────────────────────── */}
      {comPendencia > 0 && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-600/30 rounded-2xl px-5 py-4">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-amber-300 font-semibold">
              {comPendencia === 1 ? '1 plano tem período sem preço no Stripe' : `${comPendencia} planos têm períodos sem preço no Stripe`}
            </p>
            <p className="text-slate-400 text-xs mt-1 leading-relaxed">
              Período nessa situação não aparece na tela de pagamento — o cliente simplesmente não consegue
              contratá-lo. Use <strong className="text-purple-400">Sincronizar Stripe</strong> no plano marcado.
            </p>
          </div>
        </div>
      )}

      {/* ── Lista ────────────────────────────────────────────────────────────── */}
      {carregando ? (
        <div className="flex flex-col items-center gap-3 text-slate-400 py-20">
          <Loader2 size={26} className="animate-spin text-blue-400" />
          <p className="text-sm">Carregando planos...</p>
        </div>
      ) : planos.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl py-20 text-center space-y-3">
          <Layers size={34} className="text-slate-600 mx-auto" />
          <p className="text-slate-300 font-semibold">Nenhum plano cadastrado</p>
          <p className="text-slate-500 text-sm">Crie o primeiro plano para começar a vender assinaturas.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {planos.map(p => {
            const pendentes = periodosPendentes(p)
            const inativo   = p.status !== 'ATIVO'
            const ocupado   = ocupadoId === p.id
            const aviso     = avisos[p.id]

            return (
              <div
                key={p.id}
                className={`rounded-2xl border p-6 transition-colors ${
                  inativo
                    ? 'border-slate-800 bg-slate-900/40 opacity-70'
                    : 'border-slate-800 bg-slate-900'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap mb-2">
                      <h2 className="text-lg font-bold text-white">{p.nome}</h2>

                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                        inativo
                          ? 'bg-slate-800 text-slate-400 border-slate-700'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                      }`}>
                        {p.status}
                      </span>

                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/25">
                        <Users size={10} /> {p.limiteUsuario} usuário{p.limiteUsuario > 1 ? 's' : ''}
                      </span>

                      {p._count?.licencas != null && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
                          {p._count.licencas} licença{p._count.licencas === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>

                    {p.descricaoCheckout && (
                      <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-2xl">
                        {p.descricaoCheckout}
                      </p>
                    )}

                    {/* Preços por período, com o estado no Stripe ao lado */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
                      {PERIODOS.map(({ chave, label }) => {
                        const preco   = precoDoPeriodo(p, chave)
                        const priceId = priceIdDoPeriodo(p, chave)
                        const semPreco = preco == null || Number(preco) <= 0

                        return (
                          <div key={chave} className={`rounded-xl border px-4 py-3 ${
                            semPreco               ? 'border-slate-800 bg-slate-800/20'
                            : !priceId             ? 'border-amber-600/40 bg-amber-500/5'
                            :                        'border-slate-700/60 bg-slate-800/40'
                          }`}>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                            <p className={`text-base font-bold ${semPreco ? 'text-slate-600' : 'text-white'}`}>
                              {semPreco ? 'Não oferecido' : formatarReais(preco)}
                            </p>

                            {!semPreco && (
                              <p className={`flex items-center gap-1 text-[10px] mt-1.5 ${priceId ? 'text-emerald-500/80' : 'text-amber-400'}`}>
                                {priceId
                                  ? <><CheckCircle2 size={10} /> no Stripe</>
                                  : <><AlertTriangle size={10} /> falta sincronizar</>
                                }
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {pendentes.length > 0 && (
                      <p className="text-[11px] text-amber-400 mt-3">
                        {pendentes.join(', ')} {pendentes.length > 1 ? 'não aparecem' : 'não aparece'} para o cliente
                        até você sincronizar com o Stripe.
                      </p>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex lg:flex-col gap-2 shrink-0 flex-wrap">
                    <button
                      onClick={() => { setEditando(p); setModal(true) }}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      <Pencil size={13} /> Editar
                    </button>

                    <button
                      onClick={() => sincronizar(p)}
                      disabled={ocupado}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-purple-600/50 text-purple-300 hover:bg-purple-600/10 disabled:opacity-50 transition-colors"
                    >
                      {ocupado ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      Sincronizar Stripe
                    </button>

                    <button
                      onClick={() => alternarStatus(p)}
                      disabled={ocupado}
                      className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-50 ${
                        inativo
                          ? 'border-emerald-600/50 text-emerald-400 hover:bg-emerald-600/10'
                          : 'border-red-600/50 text-red-400 hover:bg-red-600/10'
                      }`}
                    >
                      {inativo ? <><Power size={13} /> Reativar</> : <><PowerOff size={13} /> Desativar</>}
                    </button>
                  </div>
                </div>

                {aviso && (
                  <p className={`text-xs mt-4 pt-3 border-t border-slate-800 ${aviso.tipo === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {aviso.texto}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Rodapé explicativo — a regra menos óbvia desta tela */}
      {!carregando && planos.length > 0 && (
        <div className="flex items-start gap-3 text-[11px] text-slate-500 bg-slate-900/60 border border-slate-800 rounded-2xl px-5 py-4 leading-relaxed">
          <CreditCard size={14} className="shrink-0 mt-0.5 text-slate-600" />
          <p>
            Alterar preço aqui muda o que o cliente <strong className="text-slate-400">vê</strong>. O que o cliente
            <strong className="text-slate-400"> paga</strong> só muda depois de sincronizar com o Stripe — preço lá é
            imutável, e a sincronização cria um preço novo e reaponta o plano. Quem já assinou permanece no valor que contratou.
          </p>
        </div>
      )}

      {modalAberto && (
        <ModalPlano
          plano={editando}
          onClose={() => setModal(false)}
          onSalvo={async () => { setModal(false); await carregar() }}
        />
      )}
    </div>
  )
}
