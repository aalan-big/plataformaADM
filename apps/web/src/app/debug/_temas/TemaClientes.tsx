'use client'

import { useState, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'
import { FormEndereco, enderecoVazio, type EnderecoForm } from '../_shared/FormEndereco'

interface ApiResponse { ok: boolean; status: number; data: unknown }

async function req(method: string, url: string, body?: unknown): Promise<ApiResponse> {
  const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
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

function inp(placeholder: string, value: string, onChange: (e: ChangeEvent<HTMLInputElement>) => void, type = 'text') {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      className="w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-500/50" />
  )
}

function SecaoRegistrar({ usuarioId }: { usuarioId: string }) {
  const [tipo,  setTipo]  = useState<'PF' | 'PJ'>('PF')
  const [nome,  setNome]  = useState('')
  const [doc,   setDoc]   = useState('')
  const [email, setEmail] = useState('')
  const [end,   setEnd]   = useState<EnderecoForm>(enderecoVazio())
  const [res,   setRes]   = useState<ApiResponse | null>(null)

  async function enviar() {
    const body: Record<string, unknown> = { tipo, email, usuarioId }
    if (tipo === 'PF') body.pf = { nomeCompleto: nome, cpf: doc }
    else               body.pj = { razaoSocial: nome, cnpj: doc }
    if (end.cep) body.endereco = end
    setRes(await req('POST', '/api/cliente/registrar', body))
  }

  return (
    <Secao titulo="POST /api/cliente/registrar — Criar Cliente">
      <div className="flex gap-2">
        {(['PF', 'PJ'] as const).map(t => (
          <button key={t} onClick={() => setTipo(t)}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${tipo === t ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>
      {inp(tipo === 'PF' ? 'Nome completo' : 'Razão Social', nome, e => setNome(e.target.value))}
      {inp(tipo === 'PF' ? 'CPF (somente números)' : 'CNPJ (somente números)', doc, e => setDoc(e.target.value))}
      {inp('E-mail', email, e => setEmail(e.target.value), 'email')}
      <p className="text-[10px] text-slate-600 uppercase tracking-wider font-bold pt-1">Endereço (opcional)</p>
      <FormEndereco form={end} onChange={setEnd} cor="rose" />
      <button onClick={enviar} className="w-full py-2 bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold rounded-lg transition-colors">Registrar</button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoListar() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="GET /api/cliente — Listar">
      {inp('Busca (nome, CPF, e-mail...)', q, e => setQ(e.target.value))}
      <button onClick={async () => setRes(await req('GET', `/api/cliente${q ? `?q=${encodeURIComponent(q)}` : ''}`))}
        className="w-full py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold rounded-lg transition-colors">
        Listar
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoBuscar() {
  const [id, setId]   = useState('')
  const [res, setRes] = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="GET /api/cliente/:id — Buscar por ID">
      {inp('ID do cliente (UUID)', id, e => setId(e.target.value))}
      <button onClick={async () => setRes(await req('GET', `/api/cliente/${id}`))}
        className="w-full py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold rounded-lg transition-colors">
        Buscar
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoEditar() {
  const [id,    setId]    = useState('')
  const [nome,  setNome]  = useState('')
  const [email, setEmail] = useState('')
  const [res,   setRes]   = useState<ApiResponse | null>(null)

  async function carregar() {
    const r = await req('GET', `/api/cliente/${id}`)
    setRes(r)
    if (r.ok && r.data && typeof r.data === 'object' && 'data' in r.data) {
      const d = (r.data as { data: { pf?: { nomeCompleto?: string }; pj?: { razaoSocial?: string }; email?: string } }).data
      setNome(d.pf?.nomeCompleto ?? d.pj?.razaoSocial ?? '')
      setEmail(d.email ?? '')
    }
  }

  return (
    <Secao titulo="PATCH /api/cliente/:id — Editar">
      <div className="flex gap-2">
        {inp('ID do cliente (UUID)', id, e => setId(e.target.value))}
        <button onClick={carregar} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap">Carregar</button>
      </div>
      {inp('Nome', nome, e => setNome(e.target.value))}
      {inp('E-mail', email, e => setEmail(e.target.value), 'email')}
      <button onClick={async () => setRes(await req('PATCH', `/api/cliente/${id}`, { nome, email }))}
        className="w-full py-2 bg-yellow-700 hover:bg-yellow-600 text-white text-xs font-bold rounded-lg transition-colors">
        Salvar
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoRemover() {
  const [id, setId]   = useState('')
  const [res, setRes] = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="DELETE /api/cliente/:id — Remover">
      {inp('ID do cliente (UUID)', id, e => setId(e.target.value))}
      <button onClick={async () => setRes(await req('DELETE', `/api/cliente/${id}`))}
        className="w-full py-2 bg-red-800 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors">
        Remover
      </button>
      <Console response={res} />
    </Secao>
  )
}

export function TemaClientes({ usuarioId }: { usuarioId: string }) {
  return (
    <>
      <SecaoRegistrar usuarioId={usuarioId} />
      <SecaoListar />
      <SecaoBuscar />
      <SecaoEditar />
      <SecaoRemover />
    </>
  )
}
