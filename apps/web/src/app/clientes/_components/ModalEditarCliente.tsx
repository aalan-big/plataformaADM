'use client'

import { useState } from 'react'
import { X, Loader2, MapPin, Search } from 'lucide-react'

type Endereco = {
  id: string
  cep: string
  logradouro: string
  numero: string
  complemento?: string | null
  bairro: string
  cidade: string
  estado: string
  tipo: string
}

type Cliente = {
  id: string
  email: string
  pf: { nomeCompleto: string; cpf: string; rg?: string | null; dataNascimento?: string | null } | null
  pj: { razaoSocial: string; cnpj: string; nomeFantasia?: string | null; inscricaoEstadual?: string | null; responsavel?: string | null } | null
  enderecos?: Endereco[]
}

interface Props {
  cliente: Cliente
  onClose: () => void
  onSuccess: () => void
}

function formatCpf(v: string)  { return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') }
function formatCnpj(v: string) { return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') }

export default function ModalEditarCliente({ cliente, onClose, onSuccess }: Props) {
  const isPF = !!cliente.pf
  const enderecoExistente = cliente.enderecos?.[0] ?? null

  const [form, setForm] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = { email: cliente.email }
    if (isPF) return {
      ...base,
      nomeCompleto:   cliente.pf?.nomeCompleto ?? '',
      cpf:            formatCpf(cliente.pf?.cpf ?? ''),
      rg:             cliente.pf?.rg ?? '',
      dataNascimento: cliente.pf?.dataNascimento
        ? new Date(cliente.pf.dataNascimento).toISOString().slice(0, 10)
        : '',
    }
    return {
      ...base,
      razaoSocial:       cliente.pj?.razaoSocial ?? '',
      cnpj:              formatCnpj(cliente.pj?.cnpj ?? ''),
      nomeFantasia:      cliente.pj?.nomeFantasia ?? '',
      inscricaoEstadual: cliente.pj?.inscricaoEstadual ?? '',
      responsavel:       cliente.pj?.responsavel ?? '',
    }
  })

  const [enviando, setEnviando]   = useState(false)
  const [erros, setErros]         = useState<{ campo: string; mensagem: string }[]>([])
  const [erroGeral, setErroGeral] = useState('')

  const [comEndereco, setComEndereco] = useState(!!enderecoExistente)
  const [endereco, setEndereco] = useState({
    cep:         enderecoExistente?.cep         ?? '',
    logradouro:  enderecoExistente?.logradouro  ?? '',
    numero:      enderecoExistente?.numero      ?? '',
    complemento: enderecoExistente?.complemento ?? '',
    bairro:      enderecoExistente?.bairro      ?? '',
    cidade:      enderecoExistente?.cidade      ?? '',
    estado:      enderecoExistente?.estado      ?? '',
    tipo:        enderecoExistente?.tipo        ?? 'PRINCIPAL',
  })
  const [buscandoCep, setBuscandoCep] = useState(false)

  function atualizar(campo: string, valor: string) {
    setForm(prev => ({ ...prev, [campo]: valor }))
    setErros(prev => prev.filter(e => e.campo !== campo))
  }

  function atualizarEndereco(campo: string, valor: string) {
    setEndereco(prev => ({ ...prev, [campo]: valor }))
  }

  async function buscarCep(cep: string) {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setBuscandoCep(true)
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setEndereco(prev => ({
          ...prev,
          logradouro: data.logradouro || '',
          bairro:     data.bairro     || '',
          cidade:     data.localidade || '',
          estado:     data.uf         || '',
        }))
      }
    } catch { /* ignora */ }
    finally { setBuscandoCep(false) }
  }

  function erroCampo(campo: string) {
    return erros.find(e => e.campo === campo)?.mensagem
  }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEnviando(true)
    setErros([])
    setErroGeral('')

    try {
      const payload = comEndereco ? { ...form, endereco } : form
      const res = await fetch(`/api/cliente/${cliente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()

      if (!res.ok) {
        if (json.detalhes) setErros(json.detalhes)
        else setErroGeral(json.erro ?? 'Erro ao atualizar cliente.')
        return
      }

      onSuccess()
    } catch {
      setErroGeral('Falha na conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">Editar Cliente</h2>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                isPF ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
              }`}>
                {isPF ? 'PF' : 'PJ'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isPF ? cliente.pf?.nomeCompleto : cliente.pj?.razaoSocial}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={enviar} className="flex-1 overflow-y-auto px-6 pt-5 pb-6 space-y-4">

          {isPF && (
            <>
              <Campo label="Nome Completo *" erro={erroCampo('nomeCompleto')}>
                <input value={form.nomeCompleto} onChange={e => atualizar('nomeCompleto', e.target.value)} className={ic(!!erroCampo('nomeCompleto'))} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="CPF *" erro={erroCampo('cpf')}>
                  <input value={form.cpf} onChange={e => atualizar('cpf', e.target.value)} placeholder="000.000.000-00" className={ic(!!erroCampo('cpf'))} />
                </Campo>
                <Campo label="RG">
                  <input value={form.rg} onChange={e => atualizar('rg', e.target.value)} placeholder="Opcional" className={ic(false)} />
                </Campo>
              </div>
              <Campo label="Data de Nascimento">
                <input type="date" value={form.dataNascimento} onChange={e => atualizar('dataNascimento', e.target.value)} className={ic(false)} />
              </Campo>
            </>
          )}

          {!isPF && (
            <>
              <Campo label="Razão Social *" erro={erroCampo('razaoSocial')}>
                <input value={form.razaoSocial} onChange={e => atualizar('razaoSocial', e.target.value)} className={ic(!!erroCampo('razaoSocial'))} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="CNPJ *" erro={erroCampo('cnpj')}>
                  <input value={form.cnpj} onChange={e => atualizar('cnpj', e.target.value)} placeholder="00.000.000/0001-00" className={ic(!!erroCampo('cnpj'))} />
                </Campo>
                <Campo label="Nome Fantasia">
                  <input value={form.nomeFantasia} onChange={e => atualizar('nomeFantasia', e.target.value)} placeholder="Opcional" className={ic(false)} />
                </Campo>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Inscrição Estadual">
                  <input value={form.inscricaoEstadual} onChange={e => atualizar('inscricaoEstadual', e.target.value)} placeholder="Opcional" className={ic(false)} />
                </Campo>
                <Campo label="Responsável">
                  <input value={form.responsavel} onChange={e => atualizar('responsavel', e.target.value)} placeholder="Opcional" className={ic(false)} />
                </Campo>
              </div>
            </>
          )}

          <Campo label="E-mail *" erro={erroCampo('email')}>
            <input type="email" value={form.email} onChange={e => atualizar('email', e.target.value)} className={ic(!!erroCampo('email'))} />
          </Campo>

          {/* ── Endereço ─────────────────────────────────────── */}
          <div className="border border-slate-700/60 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setComEndereco(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-800 transition-colors"
            >
              <div className="flex items-center gap-2.5 text-sm font-medium text-slate-300">
                <MapPin size={15} className="text-blue-400" />
                Endereço
                {enderecoExistente && (
                  <span className="text-[10px] text-slate-500 font-normal">
                    {enderecoExistente.cidade} — {enderecoExistente.estado}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                comEndereco ? 'bg-blue-600/20 text-blue-400' : 'bg-slate-700 text-slate-500'
              }`}>
                {comEndereco ? 'EDITANDO' : 'RECOLHIDO'}
              </span>
            </button>

            {comEndereco && (
              <div className="px-4 pb-4 pt-3 space-y-3 bg-slate-800/20">
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="CEP *">
                    <div className="relative">
                      <input
                        value={endereco.cep}
                        onChange={e => {
                          const v   = e.target.value.replace(/\D/g, '').slice(0, 8)
                          const fmt = v.length > 5 ? `${v.slice(0,5)}-${v.slice(5)}` : v
                          atualizarEndereco('cep', fmt)
                          if (v.length === 8) buscarCep(v)
                        }}
                        placeholder="00000-000"
                        maxLength={9}
                        className={ic(false) + ' pr-8'}
                      />
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                        {buscandoCep
                          ? <Loader2 size={13} className="animate-spin text-blue-400" />
                          : <Search size={13} className="text-slate-600" />}
                      </div>
                    </div>
                  </Campo>
                  <Campo label="Tipo">
                    <select value={endereco.tipo} onChange={e => atualizarEndereco('tipo', e.target.value)} className={ic(false)}>
                      <option value="PRINCIPAL">Principal</option>
                      <option value="FILIAL">Filial</option>
                      <option value="COBRANCA">Cobrança</option>
                      <option value="ENTREGA">Entrega</option>
                    </select>
                  </Campo>
                </div>

                <Campo label="Logradouro *">
                  <input value={endereco.logradouro} onChange={e => atualizarEndereco('logradouro', e.target.value)} placeholder="Rua, Avenida..." className={ic(false)} />
                </Campo>

                <div className="grid grid-cols-2 gap-3">
                  <Campo label="Número *">
                    <input value={endereco.numero} onChange={e => atualizarEndereco('numero', e.target.value)} placeholder="Ex: 100 ou S/N" className={ic(false)} />
                  </Campo>
                  <Campo label="Complemento">
                    <input value={endereco.complemento} onChange={e => atualizarEndereco('complemento', e.target.value)} placeholder="Sala, Bloco..." className={ic(false)} />
                  </Campo>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Campo label="Bairro *">
                    <input value={endereco.bairro} onChange={e => atualizarEndereco('bairro', e.target.value)} className={ic(false)} />
                  </Campo>
                  <Campo label="Cidade *">
                    <input value={endereco.cidade} onChange={e => atualizarEndereco('cidade', e.target.value)} className={ic(false)} />
                  </Campo>
                  <Campo label="UF *">
                    <input value={endereco.estado} onChange={e => atualizarEndereco('estado', e.target.value.toUpperCase().slice(0, 2))} placeholder="CE" maxLength={2} className={ic(false)} />
                  </Campo>
                </div>
              </div>
            )}
          </div>

          {erroGeral && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
              {erroGeral}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {enviando ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Campo({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-400">{label}</label>
      {children}
      {erro && <p className="text-xs text-red-400">{erro}</p>}
    </div>
  )
}

function ic(comErro: boolean) {
  return `w-full bg-slate-800 border ${comErro ? 'border-red-500/60' : 'border-slate-700'} text-slate-200 placeholder-slate-500 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 ${comErro ? 'focus:ring-red-500/40' : 'focus:ring-blue-500/40'} transition-all`
}
