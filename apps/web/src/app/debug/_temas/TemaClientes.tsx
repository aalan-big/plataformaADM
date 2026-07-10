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

const SETORES = ['Loja de Informática']

const REGIMES = ['Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI', 'Outro']

function SecaoRegistrar({ usuarioId }: { usuarioId: string }) {
  const [tipo, setTipo] = useState<'PF' | 'PJ'>('PJ')
  const [end,  setEnd]  = useState<EnderecoForm>(enderecoVazio())
  const [res,  setRes]  = useState<ApiResponse | null>(null)

  const [pj, setPj] = useState({
    razaoSocial: '', cnpj: '', nomeFantasia: '', email: '',
    inscricaoEstadual: '', inscricaoMunicipal: '', regimeTributario: '',
    responsavel: '', telefone: '', celular: '', setorAtividade: '',
  })

  const [pf, setPf] = useState({
    nomeCompleto: '', cpf: '', rg: '', dataNascimento: '', email: '',
  })

  function setPjF(campo: string, valor: string) { setPj(p => ({ ...p, [campo]: valor })) }
  function setPfF(campo: string, valor: string) { setPf(p => ({ ...p, [campo]: valor })) }

  async function enviar() {
    const body: Record<string, unknown> = { usuarioId }
    if (tipo === 'PJ') Object.assign(body, pj)
    else               Object.assign(body, pf)
    if (end.cep) body.endereco = end
    setRes(await req('POST', '/api/cliente/registrar', body))
  }

  const cls = 'w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-rose-500/50'
  const label = (txt: string) => <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold pt-2">{txt}</p>

  return (
    <Secao titulo="POST /api/cliente/registrar — Criar Cliente">
      <div className="flex gap-2">
        {(['PJ', 'PF'] as const).map(t => (
          <button key={t} onClick={() => setTipo(t)}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${tipo === t ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {tipo === 'PJ' && (
        <>
          {label('Dados da Empresa')}
          <input value={pj.razaoSocial}       onChange={e => setPjF('razaoSocial', e.target.value)}       placeholder="Razão Social *"          className={cls} />
          <input value={pj.cnpj}              onChange={e => setPjF('cnpj', e.target.value)}              placeholder="CNPJ * (somente números)" className={cls} />
          <input value={pj.nomeFantasia}      onChange={e => setPjF('nomeFantasia', e.target.value)}      placeholder="Nome Fantasia"            className={cls} />
          <input value={pj.email}             onChange={e => setPjF('email', e.target.value)}             placeholder="E-mail *"   type="email"  className={cls} />
          <div className="grid grid-cols-2 gap-2">
            <input value={pj.telefone}        onChange={e => setPjF('telefone', e.target.value)}          placeholder="Telefone"                 className={cls} />
            <input value={pj.celular}         onChange={e => setPjF('celular', e.target.value)}           placeholder="Celular"                  className={cls} />
          </div>
          {label('Dados Fiscais')}
          <div className="grid grid-cols-2 gap-2">
            <input value={pj.inscricaoEstadual}   onChange={e => setPjF('inscricaoEstadual', e.target.value)}   placeholder="Inscrição Estadual"   className={cls} />
            <input value={pj.inscricaoMunicipal}  onChange={e => setPjF('inscricaoMunicipal', e.target.value)}  placeholder="Inscrição Municipal"  className={cls} />
          </div>
          <select value={pj.regimeTributario} onChange={e => setPjF('regimeTributario', e.target.value)} className={cls}>
            <option value="">Regime Tributário</option>
            {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {label('Segmento e Responsável')}
          <select value={pj.setorAtividade}   onChange={e => setPjF('setorAtividade', e.target.value)}   className={cls}>
            <option value="">Setor de Atividade *</option>
            {SETORES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={pj.responsavel}       onChange={e => setPjF('responsavel', e.target.value)}       placeholder="Responsável / Sócio"     className={cls} />
        </>
      )}

      {tipo === 'PF' && (
        <>
          {label('Dados Pessoais')}
          <input value={pf.nomeCompleto}    onChange={e => setPfF('nomeCompleto', e.target.value)}    placeholder="Nome Completo *"          className={cls} />
          <div className="grid grid-cols-2 gap-2">
            <input value={pf.cpf}           onChange={e => setPfF('cpf', e.target.value)}            placeholder="CPF * (somente números)"  className={cls} />
            <input value={pf.rg}            onChange={e => setPfF('rg', e.target.value)}             placeholder="RG"                       className={cls} />
          </div>
          <input value={pf.dataNascimento}  onChange={e => setPfF('dataNascimento', e.target.value)} placeholder="Data de Nascimento"  type="date" className={cls} />
          <input value={pf.email}           onChange={e => setPfF('email', e.target.value)}          placeholder="E-mail *"            type="email" className={cls} />
        </>
      )}

      {label('Endereço (opcional)')}
      <FormEndereco form={end} onChange={setEnd} cor="rose" />

      <button onClick={enviar} className="w-full py-2 bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold rounded-lg transition-colors">
        Registrar
      </button>
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

interface ClienteItem {
  id:    string
  email: string
  pf?:   { nomeCompleto?: string } | null
  pj?:   { razaoSocial?: string }  | null
}

function nomeDoCliente(c: ClienteItem) {
  return c.pf?.nomeCompleto ?? c.pj?.razaoSocial ?? c.email
}

function SecaoRemoverClientes() {
  const [busca, setBusca]               = useState('')
  const [clientes, setClientes]         = useState<ClienteItem[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [buscando, setBuscando]         = useState(false)
  const [confirmado, setConfirmado]     = useState(false)
  const [removendo, setRemovendo]       = useState(false)
  const [res, setRes]                   = useState<ApiResponse | null>(null)

  async function buscar() {
    setBuscando(true)
    setConfirmado(false)
    const r = await req('GET', `/api/cliente${busca ? `?q=${encodeURIComponent(busca)}` : ''}`)
    setBuscando(false)
    if (r.ok && r.data && typeof r.data === 'object' && 'data' in r.data) {
      setClientes((r.data as { data: ClienteItem[] }).data)
      setSelecionados(new Set())
    } else {
      setRes(r)
    }
  }

  function alternar(id: string) {
    setSelecionados(prev => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  function alternarTodos() {
    setSelecionados(prev => prev.size === clientes.length ? new Set() : new Set(clientes.map(c => c.id)))
  }

  async function remover() {
    setRemovendo(true)
    const r = await req('DELETE', '/api/debug/remover-clientes', { ids: Array.from(selecionados) })
    setRes(r)
    setRemovendo(false)
    setConfirmado(false)
    if (r.ok) {
      setClientes(prev => prev.filter(c => !selecionados.has(c.id)))
      setSelecionados(new Set())
    }
  }

  return (
    <Secao titulo="⚠ Remover clientes selecionados">
      <p className="text-[10px] text-amber-400/80 leading-relaxed">
        Busque pelo nome, e-mail ou CPF/CNPJ, selecione quem quer apagar e confirme. Remove o cliente e todos os registros ligados a ele (endereços, licenças, pagamentos, transações). Ação irreversível.
      </p>

      <div className="flex gap-2">
        {inp('Buscar por nome, e-mail, CPF/CNPJ...', busca, e => setBusca(e.target.value))}
        <button onClick={buscar} disabled={buscando}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap">
          {buscando ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {clientes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <button onClick={alternarTodos} className="text-[10px] text-slate-400 hover:text-slate-200 underline">
              {selecionados.size === clientes.length ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
            <span className="text-[10px] text-slate-500">{selecionados.size} de {clientes.length} selecionado(s)</span>
          </div>

          <div className="max-h-56 overflow-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
            {clientes.map(c => (
              <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/60 cursor-pointer">
                <input type="checkbox" checked={selecionados.has(c.id)} onChange={() => alternar(c.id)} className="accent-red-600" />
                <span className="flex-1 truncate">
                  <span className="font-bold">{nomeDoCliente(c)}</span>
                  <span className="text-slate-500"> — {c.email}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {selecionados.size > 0 && (
        !confirmado ? (
          <button onClick={() => setConfirmado(true)}
            className="w-full py-2 bg-amber-900/60 hover:bg-amber-800/80 border border-amber-700/50 text-amber-300 text-xs font-bold rounded-lg transition-colors">
            Apagar {selecionados.size} cliente(s) selecionado(s)
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] text-red-400 font-black text-center uppercase tracking-wider">Tem certeza? Isso não pode ser desfeito.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmado(false)}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={remover} disabled={removendo}
                className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
                {removendo ? 'Removendo...' : 'CONFIRMAR E REMOVER'}
              </button>
            </div>
          </div>
        )
      )}

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
      <SecaoRemoverClientes />
    </>
  )
}
