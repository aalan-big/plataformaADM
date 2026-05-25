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
  const cor = metodo === 'POST' ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
            : metodo === 'GET'  ? 'bg-sky-950/60 text-sky-300 border-sky-800/50'
            : metodo === 'PUT'  ? 'bg-blue-950/60 text-blue-300 border-blue-800/50'
            : 'bg-yellow-950/60 text-yellow-300 border-yellow-800/50'
  return (
    <span className={`text-xs font-mono border px-2 py-0.5 rounded ${cor}`}>
      {metodo} {rota}
    </span>
  )
}

interface Plano {
  id: string
  nome: string
  status: string
  limiteUsuario: number
  precoMensal: number | string
  precoTrimestral: number | string | null
  precoAnual: number | string | null
  valorLicencaAdicional: number | string | null
  descontoTrimestral: number | string | null
  descontoAnual: number | string | null
  stripePriceIdMensal: string | null
  stripePriceIdTrimestral: string | null
  stripePriceIdAnual: string | null
  criadoEm: string
  _count?: { licencas: number }
}

function fmt(val: number | string | null | undefined) {
  if (val == null) return '—'
  return `R$ ${Number(val).toFixed(2)}`
}

function BadgeStatus({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
      status === 'ATIVO' ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50'
                        : 'bg-slate-800 text-slate-400 border-slate-600'
    }`}>{status}</span>
  )
}

const camposVazios = {
  nome: '', limiteUsuario: '1', precoMensal: '',
  precoTrimestral: '', precoAnual: '',
  valorLicencaAdicional: '', descontoTrimestral: '', descontoAnual: '',
  stripePriceIdMensal: '', stripePriceIdTrimestral: '', stripePriceIdAnual: '',
}

export function TemaPlano() {
  const [planos, setPlanos]               = useState<Plano[]>([])
  const [carregando, setCarregando]       = useState(false)
  const [resultLista, setResultLista]     = useState<ApiResponse | null>(null)

  const [form, setForm]                   = useState(camposVazios)
  const [editandoId, setEditandoId]       = useState<string | null>(null)
  const [loadSalvar, setLoadSalvar]       = useState(false)
  const [resultSalvar, setResultSalvar]   = useState<ApiResponse | null>(null)

  const [loadAcao, setLoadAcao]           = useState<Record<string, boolean>>({})
  const [resultAcao, setResultAcao]       = useState<Record<string, ApiResponse>>({})

  const fn = (k: keyof typeof camposVazios) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  const listar = async () => {
    setCarregando(true); setResultLista(null)
    const r = await api('/api/plano')
    setCarregando(false); setResultLista(r)
    if (r.ok) {
      const lista = (r.payload as any)?.data ?? []
      setPlanos(Array.isArray(lista) ? lista : [])
    }
  }

  useEffect(() => { listar() }, [])

  const preencherForm = (p: Plano) => {
    setEditandoId(p.id)
    setResultSalvar(null)
    setForm({
      nome: p.nome,
      limiteUsuario: String(p.limiteUsuario),
      precoMensal: String(Number(p.precoMensal)),
      precoTrimestral: p.precoTrimestral != null ? String(Number(p.precoTrimestral)) : '',
      precoAnual: p.precoAnual != null ? String(Number(p.precoAnual)) : '',
      valorLicencaAdicional: p.valorLicencaAdicional != null ? String(Number(p.valorLicencaAdicional)) : '',
      descontoTrimestral: p.descontoTrimestral != null ? String(Number(p.descontoTrimestral)) : '',
      descontoAnual: p.descontoAnual != null ? String(Number(p.descontoAnual)) : '',
      stripePriceIdMensal: p.stripePriceIdMensal ?? '',
      stripePriceIdTrimestral: p.stripePriceIdTrimestral ?? '',
      stripePriceIdAnual: p.stripePriceIdAnual ?? '',
    })
  }

  const limparForm = () => {
    setEditandoId(null)
    setForm(camposVazios)
    setResultSalvar(null)
  }

  const buildBody = () => ({
    nome: form.nome,
    limiteUsuario: parseInt(form.limiteUsuario) || 1,
    precoMensal: parseFloat(form.precoMensal) || 0,
    ...(form.precoTrimestral    ? { precoTrimestral:       parseFloat(form.precoTrimestral) }    : {}),
    ...(form.precoAnual         ? { precoAnual:            parseFloat(form.precoAnual) }         : {}),
    ...(form.valorLicencaAdicional ? { valorLicencaAdicional: parseFloat(form.valorLicencaAdicional) } : {}),
    ...(form.descontoTrimestral ? { descontoTrimestral:    parseFloat(form.descontoTrimestral) } : {}),
    ...(form.descontoAnual      ? { descontoAnual:         parseFloat(form.descontoAnual) }      : {}),
    ...(form.stripePriceIdMensal    ? { stripePriceIdMensal:    form.stripePriceIdMensal }    : {}),
    ...(form.stripePriceIdTrimestral ? { stripePriceIdTrimestral: form.stripePriceIdTrimestral } : {}),
    ...(form.stripePriceIdAnual     ? { stripePriceIdAnual:     form.stripePriceIdAnual }     : {}),
  })

  const salvar = async () => {
    setLoadSalvar(true); setResultSalvar(null)
    const r = editandoId
      ? await api(`/api/plano/${editandoId}`, { method: 'PUT',  body: JSON.stringify(buildBody()) })
      : await api('/api/plano',               { method: 'POST', body: JSON.stringify(buildBody()) })
    setLoadSalvar(false); setResultSalvar(r)
    if (r.ok) { await listar(); limparForm() }
  }

  const acao = async (id: string, tipo: 'desativar' | 'reativar') => {
    setLoadAcao(prev => ({ ...prev, [id]: true }))
    const r = await api(`/api/plano/${id}/${tipo}`, { method: 'PATCH' })
    setLoadAcao(prev => ({ ...prev, [id]: false }))
    setResultAcao(prev => ({ ...prev, [id]: r }))
    if (r.ok) await listar()
  }

  return (
    <div className="col-span-2 space-y-5">

      {/* ── Formulário criar / editar ── */}
      <section className="bg-[#1e293b] p-6 rounded-xl border border-purple-800/50 shadow-xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-purple-400 uppercase tracking-wider">
            {editandoId ? 'Editar Plano' : 'Criar Plano'}
          </h2>
          <div className="flex items-center gap-2">
            <RotaBadge metodo={editandoId ? 'PUT' : 'POST'} rota={editandoId ? `/api/plano/${editandoId}` : '/api/plano'} />
            {editandoId && (
              <button onClick={limparForm} className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 px-2 py-0.5 rounded transition">
                Cancelar edição
              </button>
            )}
          </div>
        </div>
        <p className="text-slate-500 text-xs mb-5">
          {editandoId ? 'Altere os campos e salve.' : 'Preencha os campos para criar um novo plano. Apenas nome, limite e preço mensal são obrigatórios.'}
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Nome do Plano *">
            <input className={`${ic} focus:border-purple-500`} placeholder="Ex: Starter, Profissional..."
              value={form.nome} onChange={fn('nome')} />
          </Field>
          <Field label="Limite de Usuários *">
            <input type="number" className={`${ic} focus:border-purple-500`} min={1}
              value={form.limiteUsuario} onChange={fn('limiteUsuario')} />
          </Field>
          <Field label="Preço Mensal (R$) *">
            <input type="number" className={`${ic} focus:border-purple-500`} placeholder="0.00" step="0.01" min={0}
              value={form.precoMensal} onChange={fn('precoMensal')} />
          </Field>
          <Field label="Preço Trimestral (R$)">
            <input type="number" className={`${ic} focus:border-purple-500`} placeholder="Opcional" step="0.01" min={0}
              value={form.precoTrimestral} onChange={fn('precoTrimestral')} />
          </Field>
          <Field label="Preço Anual (R$)">
            <input type="number" className={`${ic} focus:border-purple-500`} placeholder="Opcional" step="0.01" min={0}
              value={form.precoAnual} onChange={fn('precoAnual')} />
          </Field>
          <Field label="Valor Licença Adicional (R$)">
            <input type="number" className={`${ic} focus:border-purple-500`} placeholder="Opcional" step="0.01" min={0}
              value={form.valorLicencaAdicional} onChange={fn('valorLicencaAdicional')} />
          </Field>
          <Field label="Desconto Trimestral (%)">
            <input type="number" className={`${ic} focus:border-purple-500`} placeholder="Ex: 10" min={0} max={100}
              value={form.descontoTrimestral} onChange={fn('descontoTrimestral')} />
          </Field>
          <Field label="Desconto Anual (%)">
            <input type="number" className={`${ic} focus:border-purple-500`} placeholder="Ex: 20" min={0} max={100}
              value={form.descontoAnual} onChange={fn('descontoAnual')} />
          </Field>
          <Field label="Stripe Price ID Mensal">
            <input className={`${ic} focus:border-purple-500 font-mono text-xs`} placeholder="price_..."
              value={form.stripePriceIdMensal} onChange={fn('stripePriceIdMensal')} />
          </Field>
          <Field label="Stripe Price ID Trimestral">
            <input className={`${ic} focus:border-purple-500 font-mono text-xs`} placeholder="price_..."
              value={form.stripePriceIdTrimestral} onChange={fn('stripePriceIdTrimestral')} />
          </Field>
          <Field label="Stripe Price ID Anual">
            <input className={`${ic} focus:border-purple-500 font-mono text-xs`} placeholder="price_..."
              value={form.stripePriceIdAnual} onChange={fn('stripePriceIdAnual')} />
          </Field>
        </div>

        <button onClick={salvar} disabled={loadSalvar || !form.nome || !form.precoMensal}
          className="w-full bg-purple-700 hover:bg-purple-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
          {loadSalvar ? 'Salvando...' : editandoId ? 'Salvar Alterações' : 'Criar Plano'}
        </button>

        {resultSalvar && <Console response={resultSalvar} />}
      </section>

      {/* ── Lista de planos ── */}
      <section className="bg-[#1e293b] p-6 rounded-xl border border-slate-700/60 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-300 uppercase tracking-wider">Planos Cadastrados</h2>
          <div className="flex items-center gap-2">
            <RotaBadge metodo="GET" rota="/api/plano" />
            <button onClick={listar} disabled={carregando}
              className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 px-2 py-1 rounded transition disabled:opacity-50">
              {carregando ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </div>

        {planos.length === 0 && !carregando && (
          <p className="text-slate-500 text-sm text-center py-8">Nenhum plano encontrado.</p>
        )}

        <div className="space-y-3">
          {planos.map(p => (
            <div key={p.id} className={`p-4 rounded-lg border ${
              p.status === 'ATIVO' ? 'border-purple-800/40 bg-purple-950/10' : 'border-slate-700/40 bg-slate-800/20 opacity-60'
            }`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-200">{p.nome}</span>
                    <BadgeStatus status={p.status} />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300 border border-blue-700/50">
                      {p.limiteUsuario} usuário(s)
                    </span>
                    {p._count?.licencas != null && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-600">
                        {p._count.licencas} licença(s)
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs mb-2">
                    <span className="text-slate-500">Mensal: <span className="text-slate-300">{fmt(p.precoMensal)}</span></span>
                    <span className="text-slate-500">Trimestral: <span className="text-slate-300">{fmt(p.precoTrimestral)}</span></span>
                    <span className="text-slate-500">Anual: <span className="text-slate-300">{fmt(p.precoAnual)}</span></span>
                    {p.descontoTrimestral && <span className="text-slate-500">Desc. trim: <span className="text-slate-300">{Number(p.descontoTrimestral)}%</span></span>}
                    {p.descontoAnual      && <span className="text-slate-500">Desc. anual: <span className="text-slate-300">{Number(p.descontoAnual)}%</span></span>}
                    {p.valorLicencaAdicional && <span className="text-slate-500">Lic. adicional: <span className="text-slate-300">{fmt(p.valorLicencaAdicional)}</span></span>}
                  </div>

                  <p className="text-[10px] font-mono text-slate-700 truncate">ID: {p.id}</p>
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <button onClick={() => preencherForm(p)}
                    className="px-3 py-1 rounded text-xs font-bold border border-blue-700/60 text-blue-400 hover:bg-blue-900/30 transition">
                    Editar
                  </button>
                  {p.status === 'ATIVO'
                    ? <button onClick={() => acao(p.id, 'desativar')} disabled={loadAcao[p.id]}
                        className="px-3 py-1 rounded text-xs font-bold border border-red-700/60 text-red-400 hover:bg-red-900/30 disabled:opacity-50 transition">
                        {loadAcao[p.id] ? '...' : 'Desativar'}
                      </button>
                    : <button onClick={() => acao(p.id, 'reativar')} disabled={loadAcao[p.id]}
                        className="px-3 py-1 rounded text-xs font-bold border border-emerald-700/60 text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-50 transition">
                        {loadAcao[p.id] ? '...' : 'Reativar'}
                      </button>
                  }
                </div>
              </div>

              {resultAcao[p.id] && (
                <p className={`text-xs mt-2 font-mono ${resultAcao[p.id].ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {resultAcao[p.id].ok
                    ? (resultAcao[p.id].payload as any)?.msg ?? 'OK'
                    : JSON.stringify((resultAcao[p.id].payload as any)?.erro ?? (resultAcao[p.id].payload as any)?.message ?? resultAcao[p.id].payload)}
                </p>
              )}
            </div>
          ))}
        </div>

        {resultLista && !resultLista.ok && <Console response={resultLista} />}
      </section>
    </div>
  )
}
