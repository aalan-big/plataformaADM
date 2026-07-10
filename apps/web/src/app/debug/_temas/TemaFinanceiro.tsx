'use client'

import { useState, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'

interface ApiResponse { ok: boolean; status: number; data: unknown }

async function get(url: string): Promise<ApiResponse> {
  const res  = await fetch(url)
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

async function post(url: string, body: unknown): Promise<ApiResponse> {
  const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0f172a] p-5 space-y-3">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{titulo}</p>
      {children}
    </div>
  )
}

function inp(placeholder: string, value: string, onChange: (e: ChangeEvent<HTMLInputElement>) => void) {
  return (
    <input type="text" value={value} onChange={onChange} placeholder={placeholder}
      className="w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
  )
}

function SecaoConfirmar() {
  const [licencaId, setLicencaId] = useState('')
  const [meses, setMeses]         = useState('1')
  const [valor, setValor]         = useState('')
  const [obs, setObs]             = useState('')
  const [res, setRes]             = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="POST /api/financeiro/confirmar">
      {inp('licencaId (UUID)', licencaId, e => setLicencaId(e.target.value))}
      {inp('meses (1-24)', meses, e => setMeses(e.target.value))}
      {inp('valor (ex: 49.90)', valor, e => setValor(e.target.value))}
      {inp('observacao (opcional)', obs, e => setObs(e.target.value))}
      <button onClick={async () => setRes(await post('/api/financeiro/confirmar', { licencaId, meses: Number(meses), valor: Number(valor), observacao: obs || undefined }))}
        className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors">
        Confirmar Pagamento
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoCobranca() {
  const [licencaId, setLicencaId] = useState('')
  const [meses, setMeses]         = useState('1')
  const [res, setRes]             = useState<ApiResponse | null>(null)
  const [carregando, setCarregando] = useState(false)

  const url = res?.ok ? (res.data as any)?.url as string | undefined : undefined

  return (
    <Secao titulo="POST /api/financeiro/gerar-cobranca (Stripe Checkout)">
      {inp('licencaId (UUID)', licencaId, e => setLicencaId(e.target.value))}
      <select value={meses} onChange={e => setMeses(e.target.value)}
        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none">
        <option value="1">Mensal (1 mês)</option>
        <option value="3">Trimestral (3 meses)</option>
        <option value="12">Anual (12 meses)</option>
      </select>
      <button
        disabled={carregando || !licencaId}
        onClick={async () => {
          setCarregando(true)
          setRes(await post('/api/financeiro/gerar-cobranca', { licencaId, meses: Number(meses) }))
          setCarregando(false)
        }}
        className="w-full py-2 bg-indigo-700 hover:bg-indigo-600 disabled:bg-slate-600 text-white text-xs font-bold rounded-lg transition-colors">
        {carregando ? 'Gerando link...' : 'Gerar Link de Pagamento'}
      </button>

      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="block text-center py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors">
          → Abrir Checkout Stripe (cartão teste 4242 4242 4242 4242)
        </a>
      )}

      <Console response={res} />
    </Secao>
  )
}

function SecaoReceita() {
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  const [mes, setMes] = useState(String(new Date().getMonth() + 1))
  const [res, setRes] = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="GET /api/financeiro/receita">
      {inp('Ano', ano, e => setAno(e.target.value))}
      {inp('Mês (1-12)', mes, e => setMes(e.target.value))}
      <button onClick={async () => setRes(await get(`/api/financeiro/receita?ano=${ano}&mes=${mes}`))}
        className="w-full py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold rounded-lg transition-colors">
        Buscar Receita
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoTransacoes() {
  const [tipo, setTipo]   = useState('cliente')
  const [id, setId]       = useState('')
  const [res, setRes]     = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="GET /api/financeiro/transacoes/:tipo/:id">
      <select value={tipo} onChange={e => setTipo(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none">
        <option value="cliente">cliente</option>
        <option value="licenca">licenca</option>
      </select>
      {inp('ID (UUID)', id, e => setId(e.target.value))}
      <button onClick={async () => setRes(await get(`/api/financeiro/transacoes/${tipo}/${id}`))}
        className="w-full py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold rounded-lg transition-colors">
        Buscar Transações
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoWebhook() {
  const [licencaId, setLicencaId] = useState('')
  const [valor, setValor]         = useState('')
  const [res, setRes]             = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="POST /api/financeiro/webhook/asaas">
      {inp('externalReference (licencaId)', licencaId, e => setLicencaId(e.target.value))}
      {inp('value (valor pago)', valor, e => setValor(e.target.value))}
      <button onClick={async () => setRes(await post('/api/financeiro/webhook/asaas', {
        event: 'PAYMENT_RECEIVED', payment: { externalReference: licencaId, value: Number(valor), status: 'RECEIVED' }
      }))}
        className="w-full py-2 bg-orange-700 hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition-colors">
        Simular Webhook
      </button>
      <Console response={res} />
    </Secao>
  )
}

export function TemaFinanceiro() {
  return (
    <>
      <SecaoConfirmar />
      <SecaoCobranca />
      <SecaoReceita />
      <SecaoTransacoes />
      <SecaoWebhook />
    </>
  )
}
