'use client'

import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Console } from '../_shared/Console'
import { FormEndereco, enderecoVazio, type EnderecoForm } from '../_shared/FormEndereco'

interface ApiResponse { ok: boolean; status: number; data: unknown }

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

function inp(placeholder: string, value: string, onChange: (e: ChangeEvent<HTMLInputElement>) => void, onKey?: (e: KeyboardEvent<HTMLInputElement>) => void) {
  return (
    <input type="text" value={value} onChange={onChange} onKeyDown={onKey} placeholder={placeholder}
      className="w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
  )
}

function SecaoListar() {
  const [clienteId, setClienteId] = useState('')
  const [res, setRes]             = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="listar_enderecos — GET por clienteId">
      {inp('clienteId (UUID)', clienteId, e => setClienteId(e.target.value))}
      <button onClick={async () => setRes(await post('/api/test', { acao: 'listar_enderecos', dados: { clienteId } }))}
        className="w-full py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold rounded-lg transition-colors">
        Listar
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoAdicionar() {
  const [clienteId, setClienteId] = useState('')
  const [form, setForm]           = useState<EnderecoForm>(enderecoVazio())
  const [res, setRes]             = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="adicionar_endereco — POST">
      {inp('clienteId (UUID)', clienteId, e => setClienteId(e.target.value))}
      <FormEndereco form={form} onChange={setForm} />
      <button onClick={async () => setRes(await post('/api/test', { acao: 'adicionar_endereco', dados: { clienteId, ...form } }))}
        className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors">
        Adicionar Endereço
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoEditar() {
  const [form, setForm] = useState<EnderecoForm>(enderecoVazio())
  const [res, setRes]   = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="editar_endereco — PATCH">
      <FormEndereco form={form} onChange={setForm} modoEdicao />
      <button onClick={async () => setRes(await post('/api/test', { acao: 'editar_endereco', dados: form }))}
        className="w-full py-2 bg-yellow-700 hover:bg-yellow-600 text-white text-xs font-bold rounded-lg transition-colors">
        Salvar Alterações
      </button>
      <Console response={res} />
    </Secao>
  )
}

function SecaoRemover() {
  const [enderecoId, setEnderecoId] = useState('')
  const [res, setRes]               = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="remover_endereco — DELETE">
      {inp('enderecoId (UUID)', enderecoId, e => setEnderecoId(e.target.value))}
      <button onClick={async () => setRes(await post('/api/test', { acao: 'remover_endereco', dados: { enderecoId } }))}
        className="w-full py-2 bg-red-800 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors">
        Remover Endereço
      </button>
      <Console response={res} />
    </Secao>
  )
}

export function TemaEnderecos() {
  return (
    <>
      <SecaoListar />
      <SecaoAdicionar />
      <SecaoEditar />
      <SecaoRemover />
    </>
  )
}
