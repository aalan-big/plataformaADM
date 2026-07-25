'use client'

import { useState, useEffect, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'

interface ApiResponse {
  ok: boolean; status?: number; statusText?: string; payload?: unknown; error?: string
}

async function api(url: string, options?: RequestInit): Promise<ApiResponse> {
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options })
    const data = await res.json()
    return { status: res.status, statusText: res.statusText, ok: res.ok, payload: data }
  } catch (err) {
    return { error: 'Falha na conexão', ok: false, payload: err instanceof Error ? err.message : String(err) }
  }
}

const ic = 'w-full bg-[#0f172a] border border-slate-600 rounded p-2 outline-none transition text-sm'
const lc = 'block text-xs uppercase font-bold text-slate-500 mb-1'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={lc}>{label}</label>{children}</div>
}

function RotaBadge({ metodo, rota }: { metodo: string; rota: string }) {
  const cor = metodo === 'POST'  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
            : metodo === 'GET'   ? 'bg-sky-950/60 text-sky-300 border-sky-800/50'
            : metodo === 'PUT'   ? 'bg-blue-950/60 text-blue-300 border-blue-800/50'
            :                      'bg-amber-950/60 text-amber-300 border-amber-800/50'
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${cor}`}>
      {metodo} {rota}
    </span>
  )
}

type Parceiro = {
  id: string
  codigo: string
  nomeParceiro: string
  documento: string | null
  email: string | null
  contatoCelular: string | null
  cidadeBase: string | null
  status: string
  tipoComissao: string
  valorComissaoFixa: number | string | null
  comissaoPercentual: number | string | null
  _count?: { clientes: number; comissoes: number }
}

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const camposVazios = {
  codigo: '', nomeParceiro: '', documento: '', email: '', contatoCelular: '', cidadeBase: '',
  tipoComissao: 'FIXO_MENSAL', valorComissaoFixa: '30', comissaoPercentual: '', observacoes: '',
}

export function TemaParceiros() {
  const [parceiros, setParceiros]     = useState<Parceiro[]>([])
  const [carregando, setCarregando]   = useState(false)
  const [resultLista, setResultLista] = useState<ApiResponse | null>(null)

  const [form, setForm]               = useState(camposVazios)
  const [editandoId, setEditandoId]   = useState<string | null>(null)
  const [loadSalvar, setLoadSalvar]   = useState(false)
  const [resultSalvar, setResultSalvar] = useState<ApiResponse | null>(null)

  const [loadAcao, setLoadAcao]       = useState<Record<string, boolean>>({})
  const [resultAcao, setResultAcao]   = useState<Record<string, ApiResponse>>({})

  // Vínculo cliente ↔ parceiro
  const [clienteId, setClienteId]     = useState('')
  const [parceiroAlvo, setParceiroAlvo] = useState('')
  const [resultVinculo, setResultVinculo] = useState<ApiResponse | null>(null)

  // Repasse
  const [competencia, setCompetencia] = useState(new Date().toISOString().slice(0, 7))
  const [resultRepasse, setResultRepasse] = useState<ApiResponse | null>(null)
  const [resultComissoes, setResultComissoes] = useState<ApiResponse | null>(null)
  const [idsPagar, setIdsPagar]       = useState('')
  const [resultPagar, setResultPagar] = useState<ApiResponse | null>(null)

  const fn = (k: keyof typeof camposVazios) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  const listar = async () => {
    setCarregando(true); setResultLista(null)
    const r = await api('/api/parceiro')
    setCarregando(false); setResultLista(r)
    if (r.ok) {
      const lista = (r.payload as { data?: unknown })?.data
      setParceiros(Array.isArray(lista) ? lista : [])
    }
  }

  useEffect(() => { listar() }, [])

  const preencher = (p: Parceiro) => {
    setEditandoId(p.id); setResultSalvar(null)
    setForm({
      codigo: p.codigo, nomeParceiro: p.nomeParceiro,
      documento: p.documento ?? '', email: p.email ?? '',
      contatoCelular: p.contatoCelular ?? '', cidadeBase: p.cidadeBase ?? '',
      tipoComissao: p.tipoComissao,
      valorComissaoFixa:  p.valorComissaoFixa  != null ? String(Number(p.valorComissaoFixa))  : '',
      comissaoPercentual: p.comissaoPercentual != null ? String(Number(p.comissaoPercentual)) : '',
      observacoes: '',
    })
  }

  const limpar = () => { setEditandoId(null); setForm(camposVazios); setResultSalvar(null) }

  const buildBody = () => ({
    codigo: form.codigo,
    nomeParceiro: form.nomeParceiro,
    tipoComissao: form.tipoComissao,
    ...(form.documento      ? { documento: form.documento }           : {}),
    ...(form.email          ? { email: form.email }                   : {}),
    ...(form.contatoCelular ? { contatoCelular: form.contatoCelular } : {}),
    ...(form.cidadeBase     ? { cidadeBase: form.cidadeBase }         : {}),
    ...(form.observacoes    ? { observacoes: form.observacoes }       : {}),
    ...(form.tipoComissao === 'FIXO_MENSAL'
      ? { valorComissaoFixa: parseFloat(form.valorComissaoFixa) || 0 }
      : { comissaoPercentual: parseFloat(form.comissaoPercentual) || 0 }),
  })

  const salvar = async () => {
    setLoadSalvar(true); setResultSalvar(null)
    const r = editandoId
      ? await api(`/api/parceiro/${editandoId}`, { method: 'PUT',  body: JSON.stringify(buildBody()) })
      : await api('/api/parceiro',               { method: 'POST', body: JSON.stringify(buildBody()) })
    setLoadSalvar(false); setResultSalvar(r)
    if (r.ok) { await listar(); limpar() }
  }

  const acao = async (id: string, tipo: 'desativar' | 'reativar') => {
    setLoadAcao(p => ({ ...p, [id]: true }))
    const r = await api(`/api/parceiro/${id}/${tipo}`, { method: 'PATCH' })
    setLoadAcao(p => ({ ...p, [id]: false }))
    setResultAcao(p => ({ ...p, [id]: r }))
    if (r.ok) await listar()
  }

  const vincular = async (desvincular = false) => {
    setResultVinculo(null)
    const r = await api('/api/parceiro/vincular-cliente', {
      method: 'PATCH',
      body: JSON.stringify({ clienteId, parceiroId: desvincular ? null : parceiroAlvo }),
    })
    setResultVinculo(r)
  }

  const verRepasse = async () => {
    setResultRepasse(null)
    setResultRepasse(await api(`/api/parceiro/repasse?competencia=${competencia}`))
  }

  const verComissoes = async () => {
    setResultComissoes(null)
    setResultComissoes(await api(`/api/parceiro/comissoes?competencia=${competencia}`))
  }

  const pagar = async () => {
    setResultPagar(null)
    const ids = idsPagar.split(',').map(s => s.trim()).filter(Boolean)
    setResultPagar(await api('/api/parceiro/comissoes/pagar', {
      method: 'POST',
      body: JSON.stringify({ comissaoIds: ids, referenciaPagamento: `Repasse ${competencia}` }),
    }))
  }

  return (
    <div className="col-span-2 space-y-5">

      {/* ── Cadastro ── */}
      <section className="bg-[#1e293b] p-6 rounded-xl border border-orange-800/50 shadow-xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-orange-400 uppercase tracking-wider">
            {editandoId ? 'Editar Parceiro' : 'Novo Parceiro'}
          </h2>
          <div className="flex items-center gap-2">
            <RotaBadge metodo={editandoId ? 'PUT' : 'POST'} rota={editandoId ? `/api/parceiro/${editandoId}` : '/api/parceiro'} />
            {editandoId && (
              <button onClick={limpar} className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 px-2 py-0.5 rounded transition">
                Cancelar edição
              </button>
            )}
          </div>
        </div>
        <p className="text-slate-500 text-xs mb-5">
          O <strong className="text-slate-400">código</strong> é público: é o que o parceiro divulga e o cliente informa.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Código *">
            <input className={`${ic} focus:border-orange-500 font-mono uppercase`} placeholder="Ex: OTIK22"
              value={form.codigo} onChange={fn('codigo')} />
          </Field>
          <Field label="Nome do Parceiro *">
            <input className={`${ic} focus:border-orange-500`} placeholder="Nome ou razão social"
              value={form.nomeParceiro} onChange={fn('nomeParceiro')} />
          </Field>
          <Field label="Documento (CPF/CNPJ)">
            <input className={`${ic} focus:border-orange-500`} value={form.documento} onChange={fn('documento')} />
          </Field>
          <Field label="E-mail">
            <input className={`${ic} focus:border-orange-500`} value={form.email} onChange={fn('email')} />
          </Field>
          <Field label="Celular">
            <input className={`${ic} focus:border-orange-500`} value={form.contatoCelular} onChange={fn('contatoCelular')} />
          </Field>
          <Field label="Cidade base">
            <input className={`${ic} focus:border-orange-500`} value={form.cidadeBase} onChange={fn('cidadeBase')} />
          </Field>
          <Field label="Tipo de comissão">
            <select className={`${ic} focus:border-orange-500`} value={form.tipoComissao} onChange={fn('tipoComissao')}>
              <option value="FIXO_MENSAL">FIXO_MENSAL — R$ por mês</option>
              <option value="PERCENTUAL">PERCENTUAL — % do valor pago</option>
            </select>
          </Field>
          {form.tipoComissao === 'FIXO_MENSAL' ? (
            <Field label="Valor por mês (R$) *">
              <input type="number" step="0.01" min={0} className={`${ic} focus:border-orange-500`}
                value={form.valorComissaoFixa} onChange={fn('valorComissaoFixa')} />
            </Field>
          ) : (
            <Field label="Percentual (%) *">
              <input type="number" step="0.01" min={0} max={100} className={`${ic} focus:border-orange-500`}
                value={form.comissaoPercentual} onChange={fn('comissaoPercentual')} />
            </Field>
          )}
        </div>

        <button onClick={salvar} disabled={loadSalvar || !form.codigo || !form.nomeParceiro}
          className="w-full bg-orange-700 hover:bg-orange-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
          {loadSalvar ? 'Salvando...' : editandoId ? 'Salvar Alterações' : 'Criar Parceiro'}
        </button>

        {resultSalvar && <Console response={resultSalvar} />}
      </section>

      {/* ── Lista ── */}
      <section className="bg-[#1e293b] p-6 rounded-xl border border-slate-700/60 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-300 uppercase tracking-wider">Parceiros</h2>
          <div className="flex items-center gap-2">
            <RotaBadge metodo="GET" rota="/api/parceiro" />
            <button onClick={listar} disabled={carregando}
              className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 px-2 py-1 rounded transition disabled:opacity-50">
              {carregando ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </div>

        {parceiros.length === 0 && !carregando && (
          <p className="text-slate-500 text-sm text-center py-8">Nenhum parceiro cadastrado.</p>
        )}

        <div className="space-y-3">
          {parceiros.map(p => (
            <div key={p.id} className={`p-4 rounded-lg border ${
              p.status === 'ATIVO' ? 'border-orange-800/40 bg-orange-950/10' : 'border-slate-700/40 bg-slate-800/20 opacity-60'
            }`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-sm font-mono font-bold text-orange-300">{p.codigo}</span>
                    <span className="text-sm font-bold text-slate-200">{p.nomeParceiro}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                      p.status === 'ATIVO' ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50'
                                           : 'bg-slate-800 text-slate-400 border-slate-600'
                    }`}>{p.status}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300 border border-blue-700/50">
                      {p._count?.clientes ?? 0} cliente(s)
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-600">
                      {p._count?.comissoes ?? 0} comissão(ões)
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-x-4 text-xs">
                    <span className="text-slate-500">Regra: <span className="text-slate-300">
                      {p.tipoComissao === 'FIXO_MENSAL' ? `${fmt(p.valorComissaoFixa)}/mês` : `${Number(p.comissaoPercentual ?? 0)}%`}
                    </span></span>
                    {p.email      && <span className="text-slate-500">E-mail: <span className="text-slate-300">{p.email}</span></span>}
                    {p.cidadeBase && <span className="text-slate-500">Cidade: <span className="text-slate-300">{p.cidadeBase}</span></span>}
                  </div>

                  <p className="text-[10px] font-mono text-slate-700 truncate mt-2">ID: {p.id}</p>
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <button onClick={() => preencher(p)}
                    className="px-3 py-1 rounded text-xs font-bold border border-blue-700/60 text-blue-400 hover:bg-blue-900/30 transition">
                    Editar
                  </button>
                  <button onClick={() => acao(p.id, p.status === 'ATIVO' ? 'desativar' : 'reativar')} disabled={loadAcao[p.id]}
                    className={`px-3 py-1 rounded text-xs font-bold border transition disabled:opacity-50 ${
                      p.status === 'ATIVO' ? 'border-red-700/60 text-red-400 hover:bg-red-900/30'
                                           : 'border-emerald-700/60 text-emerald-400 hover:bg-emerald-900/30'
                    }`}>
                    {loadAcao[p.id] ? '...' : p.status === 'ATIVO' ? 'Desativar' : 'Reativar'}
                  </button>
                </div>
              </div>

              {resultAcao[p.id] && (
                <p className={`text-xs mt-2 font-mono ${resultAcao[p.id].ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {resultAcao[p.id].ok
                    ? (resultAcao[p.id].payload as { msg?: string })?.msg ?? 'OK'
                    : JSON.stringify(resultAcao[p.id].payload)}
                </p>
              )}
            </div>
          ))}
        </div>

        {resultLista && !resultLista.ok && <Console response={resultLista} />}
      </section>

      {/* ── Vínculo cliente ↔ parceiro ── */}
      <section className="bg-[#1e293b] p-6 rounded-xl border border-slate-700/60 shadow-xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-slate-300 uppercase tracking-wider">Vincular Cliente</h2>
          <RotaBadge metodo="PATCH" rota="/api/parceiro/vincular-cliente" />
        </div>
        <p className="text-slate-500 text-xs mb-4">
          Vale para os <strong className="text-slate-400">próximos</strong> pagamentos — comissões já apuradas não são
          redistribuídas.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Cliente ID">
            <input className={`${ic} focus:border-orange-500 font-mono text-xs`} placeholder="uuid do cliente"
              value={clienteId} onChange={e => setClienteId(e.target.value)} />
          </Field>
          <Field label="Parceiro">
            <select className={`${ic} focus:border-orange-500`} value={parceiroAlvo} onChange={e => setParceiroAlvo(e.target.value)}>
              <option value="">— selecione —</option>
              {parceiros.filter(p => p.status === 'ATIVO').map(p => (
                <option key={p.id} value={p.id}>{p.codigo} · {p.nomeParceiro}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex gap-2">
          <button onClick={() => vincular(false)} disabled={!clienteId || !parceiroAlvo}
            className="flex-1 bg-orange-700 hover:bg-orange-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
            Vincular
          </button>
          <button onClick={() => vincular(true)} disabled={!clienteId}
            className="px-4 border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40 rounded transition text-sm">
            Desvincular
          </button>
        </div>

        {resultVinculo && <Console response={resultVinculo} />}
      </section>

      {/* ── Repasse ── */}
      <section className="bg-[#1e293b] p-6 rounded-xl border border-emerald-800/50 shadow-xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-emerald-400 uppercase tracking-wider">Repasse</h2>
          <div className="flex gap-1.5">
            <RotaBadge metodo="GET" rota="/api/parceiro/repasse" />
            <RotaBadge metodo="POST" rota="/api/parceiro/comissoes/pagar" />
          </div>
        </div>
        <p className="text-slate-500 text-xs mb-4">
          Quanto pagar a cada parceiro na competência. A baixa só afeta comissões <strong className="text-slate-400">PENDENTE</strong>.
        </p>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <Field label="Competência (AAAA-MM)">
            <input className={`${ic} focus:border-emerald-500 font-mono`} placeholder="2026-07"
              value={competencia} onChange={e => setCompetencia(e.target.value)} />
          </Field>
          <div className="col-span-2 flex items-end gap-2">
            <button onClick={verRepasse}
              className="flex-1 bg-emerald-800 hover:bg-emerald-700 text-white font-bold py-2 rounded transition text-sm">
              Ver resumo por parceiro
            </button>
            <button onClick={verComissoes}
              className="flex-1 border border-slate-600 text-slate-300 hover:bg-slate-700 py-2 rounded transition text-sm">
              Listar comissões
            </button>
          </div>
        </div>

        {resultRepasse && <Console response={resultRepasse} />}
        {resultComissoes && <Console response={resultComissoes} />}

        <div className="mt-4 pt-4 border-t border-slate-700/40">
          <Field label="IDs de comissão para dar baixa (separados por vírgula)">
            <input className={`${ic} focus:border-emerald-500 font-mono text-xs`} placeholder="uuid, uuid, uuid"
              value={idsPagar} onChange={e => setIdsPagar(e.target.value)} />
          </Field>
          <button onClick={pagar} disabled={!idsPagar.trim()}
            className="w-full mt-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
            Marcar como PAGA
          </button>
          {resultPagar && <Console response={resultPagar} />}
        </div>
      </section>

    </div>
  )
}
