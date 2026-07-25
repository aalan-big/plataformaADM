'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Handshake, Plus, Pencil, Power, PowerOff, Loader2, Users,
  ChevronRight, Wallet, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { ModalParceiro } from './_components/ModalParceiro'
import {
  type Parceiro, type LinhaRepasse, type Comissao,
  formatarReais, regraComissao, competenciaAtual, rotuloCompetencia,
} from './_tipos'

type Aviso = { tipo: 'ok' | 'erro'; texto: string }

export default function ParceirosPage() {
  const router = useRouter()

  const [parceiros, setParceiros]     = useState<Parceiro[]>([])
  const [carregando, setCarregando]   = useState(true)
  const [modalAberto, setModal]       = useState(false)
  const [editando, setEditando]       = useState<Parceiro | null>(null)
  const [ocupadoId, setOcupadoId]     = useState<string | null>(null)
  const [avisos, setAvisos]           = useState<Record<string, Aviso>>({})

  const [competencia, setCompetencia] = useState(competenciaAtual())
  const [repasse, setRepasse]         = useState<LinhaRepasse[]>([])
  const [carregandoRepasse, setCarregandoRepasse] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const res  = await fetch('/api/parceiro')
      const json = await res.json()
      setParceiros(Array.isArray(json.data) ? json.data : [])
    } catch {
      setParceiros([])
    } finally {
      setCarregando(false)
    }
  }, [])

  const carregarRepasse = useCallback(async (comp: string) => {
    setCarregandoRepasse(true)
    try {
      const res  = await fetch(`/api/parceiro/repasse?competencia=${comp}&status=PENDENTE`)
      const json = await res.json()
      setRepasse(Array.isArray(json.data?.linhas) ? json.data.linhas : [])
    } catch {
      setRepasse([])
    } finally {
      setCarregandoRepasse(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { carregarRepasse(competencia) }, [competencia, carregarRepasse])

  const avisar = (id: string, aviso: Aviso) => setAvisos(prev => ({ ...prev, [id]: aviso }))

  async function alternarStatus(p: Parceiro) {
    const desativando = p.status === 'ATIVO'
    setOcupadoId(p.id)
    try {
      const res  = await fetch(`/api/parceiro/${p.id}/${desativando ? 'desativar' : 'reativar'}`, { method: 'PATCH' })
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

  /**
   * Baixa de repasse: busca as comissões PENDENTE do parceiro na competência e
   * marca todas como pagas. O backend só baixa o que ainda está pendente, então
   * clicar duas vezes não paga em dobro.
   */
  async function darBaixa(linha: LinhaRepasse) {
    if (!linha.parceiro) return
    const { id, codigo, nomeParceiro } = linha.parceiro

    const ok = window.confirm(
      `Confirmar repasse de ${formatarReais(linha.total)} para ${nomeParceiro} (${codigo})?\n\n` +
      `Isso marca as ${linha.quantidade} comissão(ões) de ${rotuloCompetencia(competencia)} como PAGAS.\n\n` +
      `Registre aqui só depois de ter feito a transferência de verdade.`,
    )
    if (!ok) return

    setOcupadoId(id)
    try {
      const resLista = await fetch(`/api/parceiro/comissoes?parceiroId=${id}&competencia=${competencia}&status=PENDENTE`)
      const jsonLista = await resLista.json()
      const ids = (jsonLista.data ?? []).map((c: Comissao) => c.id)

      if (ids.length === 0) throw new Error('Nenhuma comissão pendente encontrada — a lista pode estar desatualizada.')

      const res = await fetch('/api/parceiro/comissoes/pagar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ comissaoIds: ids, referenciaPagamento: `Repasse ${competencia}` }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Falha ao dar baixa.')

      avisar(id, { tipo: 'ok', texto: json.msg ?? 'Repasse registrado.' })
      await Promise.all([carregar(), carregarRepasse(competencia)])
    } catch (e) {
      avisar(id, { tipo: 'erro', texto: e instanceof Error ? e.message : 'Erro desconhecido' })
    } finally {
      setOcupadoId(null)
    }
  }

  const ativos       = parceiros.filter(p => p.status === 'ATIVO').length
  const totalPendente = repasse.reduce((s, l) => s + l.total, 0)

  return (
    <div className="space-y-5">

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-amber-950/40 border border-slate-800 p-8">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-linear-to-l from-amber-950/40 to-transparent pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold text-amber-400 uppercase tracking-[0.25em] mb-1.5">
              Programa de Indicação
            </p>
            <h1 className="text-3xl font-extrabold text-white uppercase tracking-wide">Parceiros</h1>
          </div>

          <div className="flex items-stretch gap-3 shrink-0 flex-wrap">
            <div className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-6 py-4 text-center min-w-25">
              <p className="text-2xl font-extrabold text-white">{ativos}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">Ativos</p>
            </div>
            <div className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-6 py-4 text-center min-w-30">
              <p className="text-2xl font-extrabold text-amber-400">{formatarReais(totalPendente)}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">A repassar</p>
            </div>
            <button
              onClick={() => { setEditando(null); setModal(true) }}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold px-5 rounded-xl transition-colors"
            >
              <Plus size={16} /> Novo parceiro
            </button>
          </div>
        </div>
      </div>

      {/* ── Repasse da competência ───────────────────────────────────────────── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <Wallet size={16} className="text-amber-400" />
            <h2 className="font-bold text-white">Repasse pendente</h2>
          </div>
          <input
            type="month"
            value={competencia}
            onChange={e => setCompetencia(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
        </div>

        {carregandoRepasse ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
            <Loader2 size={14} className="animate-spin" /> Apurando...
          </div>
        ) : repasse.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">
            Nenhuma comissão pendente em {rotuloCompetencia(competencia)}.
          </p>
        ) : (
          <div className="space-y-2.5">
            {repasse.map(linha => (
              <div key={`${linha.parceiro?.id}-${linha.status}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-800/40 border border-slate-700/60 rounded-xl px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-200">
                    <span className="font-mono text-amber-400">{linha.parceiro?.codigo}</span>
                    {' · '}{linha.parceiro?.nomeParceiro}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {linha.quantidade} comissão{linha.quantidade === 1 ? '' : 'ões'} em {rotuloCompetencia(competencia)}
                  </p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <p className="text-lg font-bold text-white">{formatarReais(linha.total)}</p>
                  <button
                    onClick={() => darBaixa(linha)}
                    disabled={ocupadoId === linha.parceiro?.id}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-emerald-600/50 text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50 transition-colors"
                  >
                    {ocupadoId === linha.parceiro?.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <CheckCircle2 size={13} />}
                    Dar baixa
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="flex items-start gap-2 text-[11px] text-slate-500 mt-5 pt-4 border-t border-slate-800 leading-relaxed">
          <AlertCircle size={13} className="shrink-0 mt-0.5 text-slate-600" />
          Dar baixa apenas <strong className="text-slate-400">registra</strong> que você pagou — não transfere dinheiro.
          Faça a transferência primeiro e marque aqui depois.
        </p>
      </section>

      {/* ── Lista de parceiros ───────────────────────────────────────────────── */}
      {carregando ? (
        <div className="flex flex-col items-center gap-3 text-slate-400 py-20">
          <Loader2 size={26} className="animate-spin text-amber-400" />
          <p className="text-sm">Carregando parceiros...</p>
        </div>
      ) : parceiros.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl py-20 text-center space-y-3">
          <Handshake size={34} className="text-slate-600 mx-auto" />
          <p className="text-slate-300 font-semibold">Nenhum parceiro cadastrado</p>
          <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
            Cadastre o primeiro parceiro para começar a vincular clientes e apurar repasse automaticamente a cada pagamento.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {parceiros.map(p => {
            const inativo = p.status !== 'ATIVO'
            const ocupado = ocupadoId === p.id
            const aviso   = avisos[p.id]

            return (
              <div key={p.id} className={`rounded-2xl border p-6 transition-colors ${
                inativo ? 'border-slate-800 bg-slate-900/40 opacity-70' : 'border-slate-800 bg-slate-900'
              }`}>
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">

                  <button onClick={() => router.push(`/parceiros/${p.id}`)} className="min-w-0 flex-1 text-left group">
                    <div className="flex items-center gap-2.5 flex-wrap mb-2">
                      <span className="font-mono text-sm font-bold text-amber-400">{p.codigo}</span>
                      <h2 className="text-lg font-bold text-white group-hover:text-amber-300 transition-colors">
                        {p.nomeParceiro}
                      </h2>
                      <ChevronRight size={14} className="text-slate-600 group-hover:text-amber-400 transition-colors" />

                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                        inativo
                          ? 'bg-slate-800 text-slate-400 border-slate-700'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                      }`}>
                        {p.status}
                      </span>

                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/25">
                        <Users size={10} /> {p._count?.clientes ?? 0} cliente{p._count?.clientes === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs text-slate-500 max-w-2xl">
                      <span>Comissão: <span className="text-slate-300">{regraComissao(p)}</span></span>
                      {p.email      && <span>E-mail: <span className="text-slate-300">{p.email}</span></span>}
                      {p.cidadeBase && <span>Cidade: <span className="text-slate-300">{p.cidadeBase}</span></span>}
                    </div>
                  </button>

                  <div className="flex lg:flex-col gap-2 shrink-0 flex-wrap">
                    <button
                      onClick={() => { setEditando(p); setModal(true) }}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      <Pencil size={13} /> Editar
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

      {modalAberto && (
        <ModalParceiro
          parceiro={editando}
          onClose={() => setModal(false)}
          onSalvo={async () => { setModal(false); await carregar() }}
        />
      )}
    </div>
  )
}
