'use client'

import { useState, useEffect, useCallback } from 'react'
import { MapPinned, RefreshCw, CircleAlert, Plus, Save, X } from 'lucide-react'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Rota = 'NACIONAL' | 'MUNICIPAL' | 'DESCONHECIDA'

type Municipio = {
  codigoIbge:           string
  nome:                 string
  uf:                   string
  rotaNaoMei:           Rota
  exigeLoginPrefeitura: boolean
  observacao:           string | null
  nfseHabilitada:       boolean | null
  statusNfse:           string | null
  provedorNfse:         string | null
  requerCertificado:    boolean | null
  possuiHomologacao:    boolean | null
  possuiCancelamento:   boolean | null
  obrigatorios:         Record<string, boolean | null> | null
  consultadoFocusEm:    string | null
  clientes:             number
  pendentes:            number
}

const ROTAS: Record<Rota, string> = {
  NACIONAL:     'Nacional (nfse.gov.br)',
  MUNICIPAL:    'Municipal (prefeitura)',
  DESCONHECIDA: 'A decidir',
}

/** Nomes de tela dos `*_obrigatorio_nfse` da Focus (sem o sufixo). */
const CAMPOS: Record<string, string> = {
  endereco:                   'Endereço do tomador',
  cpf_cnpj:                   'CPF/CNPJ do tomador',
  codigo_cnae:                'CNAE',
  item_lista_servico:         'Item da LC 116',
  codigo_tributario_municipio: 'Código tributário municipal',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function quando(iso: string | null) {
  if (!iso) return 'nunca'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function simNao(v: boolean | null) {
  return v === null ? '?' : v ? 'sim' : 'não'
}

function BadgeStatus({ status }: { status: string | null }) {
  const cls = status === 'ativo'
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : status
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold ${cls}`}>
      {status ?? 'sem consulta'}
    </span>
  )
}

// ─── Linha editável ───────────────────────────────────────────────────────────

function LinhaMunicipio({ m, onSalvo }: { m: Municipio; onSalvo: (m: Municipio) => void }) {
  const [rota, setRota]             = useState<Rota>(m.rotaNaoMei)
  const [exigeLogin, setExigeLogin] = useState(m.exigeLoginPrefeitura)
  const [observacao, setObservacao] = useState(m.observacao ?? '')
  const [ocupado, setOcupado]       = useState<'' | 'salvar' | 'focus'>('')
  const [erro, setErro]             = useState('')

  const mudou = rota !== m.rotaNaoMei || exigeLogin !== m.exigeLoginPrefeitura || observacao !== (m.observacao ?? '')
  const exigidos = Object.entries(m.obrigatorios ?? {}).filter(([, v]) => v === true).map(([k]) => CAMPOS[k] ?? k)

  async function salvar() {
    setOcupado('salvar'); setErro('')
    try {
      const res = await fetch(`/api/fiscal/municipios/${m.codigoIbge}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotaNaoMei: rota, exigeLoginPrefeitura: exigeLogin, observacao: observacao || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.mensagem ?? json.message ?? `Erro ${res.status}.`)
      onSalvo({ ...m, ...json })
    } catch (e: any) {
      setErro(e.message || 'Falha ao salvar.')
    } finally {
      setOcupado('')
    }
  }

  async function atualizarDaFocus() {
    setOcupado('focus'); setErro('')
    try {
      const res  = await fetch(`/api/fiscal/municipios/${m.codigoIbge}/atualizar`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.mensagem ?? json.message ?? `Erro ${res.status}.`)
      onSalvo({ ...m, ...json })
    } catch (e: any) {
      setErro(e.message || 'A Focus não respondeu.')
    } finally {
      setOcupado('')
    }
  }

  return (
    <tr className="align-top hover:bg-slate-800/30 transition-colors">
      <td className="px-5 py-4">
        <p className="font-medium text-slate-200 text-[13px]">{m.nome} / {m.uf}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">IBGE {m.codigoIbge}</p>
        <p className="text-[11px] text-slate-500 mt-1">
          {m.clientes} cliente{m.clientes === 1 ? '' : 's'}
          {m.pendentes > 0 && <span className="text-amber-400 font-semibold"> · {m.pendentes} esperando decisão</span>}
        </p>
      </td>

      <td className="px-5 py-4 space-y-1 text-[11px] text-slate-400">
        <BadgeStatus status={m.statusNfse} />
        <p>Provedor: <span className="text-slate-300">{m.provedorNfse ?? '?'}</span></p>
        <p>Homologação: {simNao(m.possuiHomologacao)} · Cancelamento: {simNao(m.possuiCancelamento)}</p>
        <p>Certificado: {simNao(m.requerCertificado)}</p>
        {exigidos.length > 0 && <p className="text-slate-300">Exige: {exigidos.join(', ')}</p>}
        <p className="text-slate-600">Consultado: {quando(m.consultadoFocusEm)}</p>
      </td>

      <td className="px-5 py-4 space-y-2 min-w-64">
        <select
          value={rota}
          onChange={e => setRota(e.target.value as Rota)}
          className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          {Object.entries(ROTAS).map(([valor, label]) => <option key={valor} value={valor}>{label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[12px] text-slate-400">
          <input type="checkbox" checked={exigeLogin} onChange={e => setExigeLogin(e.target.checked)} />
          Prefeitura exige login e senha
        </label>
        <textarea
          value={observacao}
          onChange={e => setObservacao(e.target.value)}
          placeholder="Ex.: não MEI vai pela municipal (aviso do painel da Focus)"
          rows={2}
          maxLength={500}
          className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-600 text-[12px] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        {erro && <p className="text-[11px] text-red-400">{erro}</p>}
      </td>

      <td className="px-5 py-4">
        <div className="flex flex-col gap-2 items-stretch">
          <button
            onClick={salvar}
            disabled={!mudou || !!ocupado}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
          >
            <Save size={11} /> {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            onClick={atualizarDaFocus}
            disabled={!!ocupado}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 text-slate-300 hover:border-blue-500/50 hover:text-blue-400 disabled:opacity-40 transition-all"
          >
            <RefreshCw size={11} className={ocupado === 'focus' ? 'animate-spin' : ''} /> Atualizar da Focus
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function MunicipiosNfsePage() {
  const [lista, setLista]           = useState<Municipio[] | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState('')
  const [novo, setNovo]             = useState('')
  const [incluindo, setIncluindo]   = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const res  = await fetch('/api/fiscal/municipios')
      const json = await res.json().catch(() => [])
      if (!res.ok) throw new Error(json.message ?? `Erro ${res.status}.`)
      setLista(json)
    } catch (e: any) {
      setErro(e.message || 'Falha ao carregar os municípios.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function incluir() {
    const codigo = novo.replace(/\D/g, '')
    if (codigo.length !== 7) { setErro('Informe o código IBGE com 7 dígitos.'); return }
    setIncluindo(true); setErro('')
    try {
      const res  = await fetch(`/api/fiscal/municipios/${codigo}/atualizar`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.mensagem ?? json.message ?? `Erro ${res.status}.`)
      setNovo('')
      await carregar()
    } catch (e: any) {
      setErro(e.message || 'A Focus não respondeu.')
    } finally {
      setIncluindo(false)
    }
  }

  const pendentes = (lista ?? []).reduce((n, m) => n + m.pendentes, 0)
  const STATS = [
    { label: 'Cidades',            valor: lista?.length,                                                cor: 'text-slate-200' },
    { label: 'A decidir',          valor: lista?.filter(m => m.rotaNaoMei === 'DESCONHECIDA').length,  cor: 'text-amber-400' },
    { label: 'Clientes esperando', valor: lista ? pendentes : undefined,                                cor: pendentes ? 'text-red-400' : 'text-emerald-400' },
  ]

  return (
    <div className="space-y-5">

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-blue-950 border border-slate-800 p-8">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-[0.25em] mb-1.5">Fiscal</p>
            <h1 className="text-3xl font-extrabold text-white uppercase tracking-wide">Municípios NFS-e</h1>
            <p className="text-slate-400 text-[13px] mt-2 max-w-xl">
              Por onde sai a nota de serviço de quem <b>não é MEI</b> em cada cidade (MEI vai sempre pela Nacional).
              A cidade entra aqui sozinha na primeira ativação de um cliente dela. Decidida a rota, os clientes
              pendentes passam a usá-la quando reenviarem o certificado ou quando você trocar a rota no perfil deles.
            </p>
          </div>
          <div className="flex items-stretch gap-3 shrink-0 flex-wrap">
            {STATS.map(s => (
              <div key={s.label} className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-5 py-3 text-center min-w-18">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className={`text-2xl font-extrabold ${s.cor}`}>{s.valor ?? '—'}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── INCLUIR ──────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Código IBGE (7 dígitos)"
          value={novo}
          onChange={e => setNovo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && incluir()}
          className="w-56 bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <button
          onClick={incluir}
          disabled={incluindo}
          className="flex items-center gap-2 border border-slate-700 text-slate-300 hover:border-blue-500/50 hover:text-blue-400 disabled:opacity-50 text-sm font-semibold px-4 py-2 rounded-lg transition-all"
        >
          <Plus size={14} /> {incluindo ? 'Consultando…' : 'Incluir cidade'}
        </button>
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
          <button onClick={() => setErro('')} className="ml-auto text-red-400/70 hover:text-red-300"><X size={12} /></button>
        </div>
      )}

      {/* ── TABELA ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Cidade</th>
                <th className="text-left px-5 py-3 font-semibold">O que a Focus diz</th>
                <th className="text-left px-5 py-3 font-semibold">Nossa decisão (não MEI)</th>
                <th className="text-left px-5 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {carregando && !lista && (
                <tr>
                  <td colSpan={4} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-slate-500 text-xs">Carregando municípios...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!carregando && lista?.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2">
                      <MapPinned size={28} className="text-slate-700" />
                      <p className="text-slate-500 text-sm">Nenhuma cidade ainda.</p>
                      <p className="text-[11px] text-slate-600 max-w-sm">
                        As cidades aparecem quando um cliente com NFS-e ativa a emissão, ou pelo código IBGE acima.
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {lista?.map(m => (
                <LinhaMunicipio
                  key={`${m.codigoIbge}-${m.consultadoFocusEm}-${m.rotaNaoMei}`}
                  m={m}
                  onSalvo={salvo => setLista(l => l?.map(x => x.codigoIbge === salvo.codigoIbge ? salvo : x) ?? null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
