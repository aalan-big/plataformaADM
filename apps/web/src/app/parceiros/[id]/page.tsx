'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, Users, Receipt, Mail, MapPin, IdCard,
  Clock, CheckCircle2, XCircle,
} from 'lucide-react'
import {
  type ParceiroDetalhe, formatarReais, formatarData,
  nomeCliente, regraComissao, rotuloCompetencia,
} from '../_tipos'

function BadgeStatusComissao({ status }: { status: string }) {
  const estilo = status === 'PAGA'      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
               : status === 'CANCELADA' ? 'bg-slate-800 text-slate-500 border-slate-700'
               :                          'bg-amber-500/10 text-amber-400 border-amber-500/25'
  const Icone  = status === 'PAGA' ? CheckCircle2 : status === 'CANCELADA' ? XCircle : Clock

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${estilo}`}>
      <Icone size={10} /> {status}
    </span>
  )
}

export default function ParceiroDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id }  = use(params)
  const router  = useRouter()

  const [parceiro, setParceiro]     = useState<ParceiroDetalhe | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const res  = await fetch(`/api/parceiro/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Parceiro não encontrado.')
      setParceiro(json.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setCarregando(false)
    }
  }, [id])

  useEffect(() => { carregar() }, [carregar])

  if (carregando) {
    return (
      <div className="flex flex-col items-center gap-3 text-slate-400 py-20">
        <Loader2 size={26} className="animate-spin text-amber-400" />
        <p className="text-sm">Carregando parceiro...</p>
      </div>
    )
  }

  if (erro || !parceiro) {
    return (
      <div className="bg-slate-900 border border-red-500/20 rounded-2xl py-16 text-center space-y-3">
        <p className="text-white font-semibold">Não foi possível abrir o parceiro</p>
        <p className="text-slate-400 text-sm">{erro}</p>
        <button onClick={() => router.push('/parceiros')}
          className="text-sm text-amber-400 hover:text-amber-300 underline underline-offset-4">
          Voltar para a lista
        </button>
      </div>
    )
  }

  const inativo = parceiro.status !== 'ATIVO'

  return (
    <div className="space-y-5">

      <button onClick={() => router.push('/parceiros')}
        className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
        <ArrowLeft size={15} /> Parceiros
      </button>

      {/* ── Cabeçalho ────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-amber-950/40 border border-slate-800 p-8">
        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
              <span className="font-mono text-sm font-bold text-amber-400">{parceiro.codigo}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                inativo ? 'bg-slate-800 text-slate-400 border-slate-700'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
              }`}>{parceiro.status}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-wide">{parceiro.nomeParceiro}</h1>
            <p className="text-sm text-slate-400 mt-1.5">Comissão: {regraComissao(parceiro)}</p>
          </div>

          <div className="flex items-stretch gap-3 shrink-0 flex-wrap">
            <div className="bg-slate-800/70 border border-slate-700/50 rounded-xl px-5 py-4 text-center min-w-28">
              <p className="text-xl font-extrabold text-amber-400">{formatarReais(parceiro.totais.pendente)}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">A receber</p>
            </div>
            <div className="bg-slate-800/70 border border-slate-700/50 rounded-xl px-5 py-4 text-center min-w-28">
              <p className="text-xl font-extrabold text-emerald-400">{formatarReais(parceiro.totais.pago)}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">Já pago</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Dados de contato ─────────────────────────────────────────────────── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="font-bold text-white mb-4">Dados</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="flex items-start gap-2.5">
            <IdCard size={14} className="text-slate-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wide">Documento</p>
              <p className="text-slate-300">{parceiro.documento ?? '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Mail size={14} className="text-slate-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 uppercase tracking-wide">E-mail</p>
              <p className="text-slate-300 truncate">{parceiro.email ?? '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <MapPin size={14} className="text-slate-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wide">Cidade</p>
              <p className="text-slate-300">{parceiro.cidadeBase ?? '—'}</p>
            </div>
          </div>
        </div>

        {parceiro.observacoes && (
          <p className="text-xs text-slate-400 leading-relaxed mt-5 pt-4 border-t border-slate-800">
            {parceiro.observacoes}
          </p>
        )}
      </section>

      {/* ── Clientes indicados ───────────────────────────────────────────────── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <Users size={16} className="text-blue-400" />
          <h2 className="font-bold text-white">Clientes indicados</h2>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
            {parceiro.clientes.length}
          </span>
        </div>

        {parceiro.clientes.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">
            Nenhum cliente vinculado ainda. O vínculo é feito no cadastro do cliente.
          </p>
        ) : (
          <div className="space-y-2">
            {parceiro.clientes.map(c => {
              const licenca = c.dispositivos?.[0]
              return (
                <div key={c.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-800/40 border border-slate-700/60 rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate">{nomeCliente(c)}</p>
                    <p className="text-[11px] text-slate-500 truncate">{c.email}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    {licenca?.plano && <span className="text-slate-400">{licenca.plano.nome}</span>}
                    {licenca && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                        licenca.status === 'ATIVA'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>{licenca.status}</span>
                    )}
                    <span className="text-slate-500">desde {formatarData(c.criadoEm)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Extrato de comissões ─────────────────────────────────────────────── */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <Receipt size={16} className="text-amber-400" />
          <h2 className="font-bold text-white">Extrato de comissões</h2>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
            {parceiro.comissoes.length}
          </span>
        </div>

        {parceiro.comissoes.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">
            Nenhuma comissão apurada. Elas nascem automaticamente a cada pagamento de um cliente vinculado.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm min-w-160">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
                  <th className="text-left font-semibold pb-2.5">Competência</th>
                  <th className="text-left font-semibold pb-2.5">Cliente</th>
                  <th className="text-right font-semibold pb-2.5">Pago pelo cliente</th>
                  <th className="text-center font-semibold pb-2.5">Meses</th>
                  <th className="text-right font-semibold pb-2.5">Comissão</th>
                  <th className="text-center font-semibold pb-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {parceiro.comissoes.map(c => (
                  <tr key={c.id} className="text-slate-300">
                    <td className="py-3 text-xs text-slate-400">{rotuloCompetencia(c.competencia)}</td>
                    <td className="py-3 text-xs truncate max-w-40">{nomeCliente(c.cliente)}</td>
                    <td className="py-3 text-right text-xs text-slate-400">{formatarReais(c.valorBase)}</td>
                    <td className="py-3 text-center text-xs text-slate-400">{c.meses}</td>
                    <td className="py-3 text-right font-semibold">{formatarReais(c.valor)}</td>
                    <td className="py-3 text-center"><BadgeStatusComissao status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-slate-500 mt-5 pt-4 border-t border-slate-800 leading-relaxed">
          Cada linha guarda a regra que valia no dia da apuração. Alterar a comissão do parceiro muda o cálculo dos
          próximos pagamentos, nunca o que já está aqui.
        </p>
      </section>
    </div>
  )
}
