'use client'

import { useState, type ChangeEvent, type KeyboardEvent } from 'react'

export interface EnderecoForm {
  id: string
  cep: string
  tipo: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  estado: string
}

export function enderecoVazio(): EnderecoForm {
  return { id: '', cep: '', tipo: 'PRINCIPAL', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' }
}

const TIPOS = ['PRINCIPAL', 'FILIAL', 'COBRANCA', 'ENTREGA']
const UFS   = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

interface Props {
  form: EnderecoForm
  onChange: (f: EnderecoForm) => void
  modoEdicao?: boolean
  cor?: string
}

export function FormEndereco({ form, onChange, modoEdicao = false, cor = 'cyan' }: Props) {
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [erroCep, setErroCep]         = useState('')

  function set(field: keyof EnderecoForm, value: string) {
    onChange({ ...form, [field]: value })
  }

  async function buscarCep() {
    const cep = form.cep.replace(/\D/g, '')
    if (cep.length !== 8) { setErroCep('CEP deve ter 8 dígitos.'); return }
    setBuscandoCep(true); setErroCep('')
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const data = await res.json()
      if (data.erro) { setErroCep('CEP não encontrado.'); return }
      onChange({ ...form, logradouro: data.logradouro ?? '', bairro: data.bairro ?? '', cidade: data.localidade ?? '', estado: data.estado ?? '' })
    } catch { setErroCep('Falha ao buscar CEP.') }
    finally { setBuscandoCep(false) }
  }

  function onCepKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') buscarCep()
  }

  const inpBase = 'bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500/50'
  const inp = `w-full ${inpBase}`

  return (
    <div className="space-y-2">
      {modoEdicao && (
        <input value={form.id} onChange={e => set('id', e.target.value)} placeholder="UUID do endereço" className={inp} />
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <input
            value={form.cep}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('cep', e.target.value)}
            onBlur={buscarCep}
            onKeyDown={onCepKey}
            placeholder="CEP (somente números)"
            className={inp}
          />
          {erroCep && <p className="text-red-400 text-[10px] mt-0.5">{erroCep}</p>}
        </div>
        <button
          type="button"
          onClick={buscarCep}
          disabled={buscandoCep}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors disabled:opacity-50"
        >
          {buscandoCep ? '...' : 'Buscar'}
        </button>
      </div>

      <select value={form.tipo} onChange={e => set('tipo', e.target.value)} className={inp}>
        {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <input value={form.logradouro} onChange={e => set('logradouro', e.target.value)} placeholder="Logradouro" className={inp} />

      <div className="flex gap-2">
        <input value={form.numero} onChange={e => set('numero', e.target.value)} placeholder="Número" className={`${inpBase} w-24`} />
        <input value={form.complemento} onChange={e => set('complemento', e.target.value)} placeholder="Complemento" className={`${inpBase} flex-1`} />
      </div>

      <input value={form.bairro} onChange={e => set('bairro', e.target.value)} placeholder="Bairro" className={inp} />

      <div className="flex gap-2">
        <input value={form.cidade} onChange={e => set('cidade', e.target.value)} placeholder="Cidade" className={`${inpBase} flex-1`} />
        <select value={form.estado} onChange={e => set('estado', e.target.value)} className={`${inpBase} w-20`}>
          <option value="">UF</option>
          {UFS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
    </div>
  )
}
