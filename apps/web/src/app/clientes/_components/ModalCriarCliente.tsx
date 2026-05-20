'use client'

import { useState } from 'react'
import { X, User, Building2, Loader2, MapPin, Search } from 'lucide-react'

const estadoEnderecoInicial = {
  cep: '', logradouro: '', numero: '', complemento: '',
  bairro: '', cidade: '', estado: '', tipo: 'PRINCIPAL',
}

function aplicarMascaraCpf(valor: string) {
  const d = valor.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

function aplicarMascaraCnpj(valor: string) {
  const d = valor.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

function getUsuarioId(): string {
  try {
    const raw = localStorage.getItem('user_data')
    if (!raw) return ''
    const u = JSON.parse(raw)
    return u?.id ?? ''
  } catch { return '' }
}

type Tipo = 'PF' | 'PJ'

const estadoInicial = {
  PF: { tipo: 'PF' as Tipo, nomeCompleto: '', cpf: '', rg: '', dataNascimento: '', email: '' },
  PJ: { tipo: 'PJ' as Tipo, razaoSocial: '', cnpj: '', nomeFantasia: '', inscricaoEstadual: '', responsavel: '', email: '' },
}

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function ModalCriarCliente({ onClose, onSuccess }: Props) {
  const [tipo, setTipo] = useState<Tipo>('PJ')
  const [form, setForm] = useState<Record<string, string>>(estadoInicial.PJ)
  const [enviando, setEnviando] = useState(false)
  const [erros, setErros] = useState<{ campo: string; mensagem: string }[]>([])
  const [erroGeral, setErroGeral] = useState('')

  const [comEndereco, setComEndereco] = useState(false)
  const [endereco, setEndereco] = useState<Record<string, string>>(estadoEnderecoInicial)
  const [buscandoCep, setBuscandoCep] = useState(false)

  function selecionarTipo(t: Tipo) {
    setTipo(t)
    setForm(estadoInicial[t])
    setErros([])
    setErroGeral('')
  }

  function atualizarEndereco(campo: string, valor: string) {
    setEndereco(prev => ({ ...prev, [campo]: valor }))
  }

  async function buscarCep(cep: string) {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setBuscandoCep(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
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

  function atualizar(campo: string, valor: string) {
    setForm(prev => ({ ...prev, [campo]: valor }))
    setErros(prev => prev.filter(e => e.campo !== campo))
  }

  function erroCampo(campo: string) {
    return erros.find(e => e.campo === campo)?.mensagem
  }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEnviando(true)
    setErros([])
    setErroGeral('')

    const usuarioId = getUsuarioId()
    if (!usuarioId) {
      setErroGeral('Sessão expirada. Faça login novamente.')
      setEnviando(false)
      return
    }

    try {
      const payload = { ...form, usuarioId, ...(comEndereco ? { endereco } : {}) }
      const res = await fetch('/api/cliente/registrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()

      if (!res.ok) {
        if (json.detalhes) setErros(json.detalhes)
        else setErroGeral(json.erro ?? 'Erro ao cadastrar cliente.')
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
            <h2 className="text-lg font-bold text-slate-100">Novo Cliente</h2>
            <p className="text-xs text-slate-400 mt-0.5">Preencha os dados para cadastrar no sistema</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pt-5 pb-1">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Tipo de Cliente</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => selecionarTipo('PJ')}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                tipo === 'PJ'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
              }`}
            >
              <Building2 size={20} />
              <div className="text-left">
                <p className="font-semibold text-sm">Pessoa Jurídica</p>
                <p className="text-xs opacity-70">Empresa / CNPJ</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => selecionarTipo('PF')}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                tipo === 'PF'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
              }`}
            >
              <User size={20} />
              <div className="text-left">
                <p className="font-semibold text-sm">Pessoa Física</p>
                <p className="text-xs opacity-70">Autônomo / CPF</p>
              </div>
            </button>
          </div>
        </div>

        <form onSubmit={enviar} className="flex-1 overflow-y-auto px-6 pt-4 pb-6 space-y-4">

          {tipo === 'PJ' && (
            <>
              <Campo label="Razão Social *" erro={erroCampo('razaoSocial')}>
                <input
                  value={form.razaoSocial}
                  onChange={e => atualizar('razaoSocial', e.target.value)}
                  placeholder="Ex: Alpha Tecnologia Ltda"
                  className={inputClass(!!erroCampo('razaoSocial'))}
                />
              </Campo>

              <div className="grid grid-cols-2 gap-3">
                <Campo label="CNPJ *" erro={erroCampo('cnpj')}>
                  <input
                    value={form.cnpj}
                    onChange={e => atualizar('cnpj', aplicarMascaraCnpj(e.target.value))}
                    placeholder="00.000.000/0001-00"
                    maxLength={18}
                    className={inputClass(!!erroCampo('cnpj'))}
                  />
                </Campo>
                <Campo label="Nome Fantasia">
                  <input
                    value={form.nomeFantasia}
                    onChange={e => atualizar('nomeFantasia', e.target.value)}
                    placeholder="Como é conhecido"
                    className={inputClass(false)}
                  />
                </Campo>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Campo label="Inscrição Estadual">
                  <input
                    value={form.inscricaoEstadual}
                    onChange={e => atualizar('inscricaoEstadual', e.target.value)}
                    placeholder="Opcional"
                    className={inputClass(false)}
                  />
                </Campo>
                <Campo label="Responsável">
                  <input
                    value={form.responsavel}
                    onChange={e => atualizar('responsavel', e.target.value)}
                    placeholder="Nome do sócio ou responsável"
                    className={inputClass(false)}
                  />
                </Campo>
              </div>
            </>
          )}

          {tipo === 'PF' && (
            <>
              <Campo label="Nome Completo *" erro={erroCampo('nomeCompleto')}>
                <input
                  value={form.nomeCompleto}
                  onChange={e => atualizar('nomeCompleto', e.target.value)}
                  placeholder="Nome conforme documento"
                  className={inputClass(!!erroCampo('nomeCompleto'))}
                />
              </Campo>

              <div className="grid grid-cols-2 gap-3">
                <Campo label="CPF *" erro={erroCampo('cpf')}>
                  <input
                    value={form.cpf}
                    onChange={e => atualizar('cpf', aplicarMascaraCpf(e.target.value))}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    className={inputClass(!!erroCampo('cpf'))}
                  />
                </Campo>
                <Campo label="RG">
                  <input
                    value={form.rg}
                    onChange={e => atualizar('rg', e.target.value)}
                    placeholder="Opcional"
                    className={inputClass(false)}
                  />
                </Campo>
              </div>

              <Campo label="Data de Nascimento">
                <input
                  type="date"
                  value={form.dataNascimento}
                  onChange={e => atualizar('dataNascimento', e.target.value)}
                  className={inputClass(false)}
                />
              </Campo>
            </>
          )}

          <Campo label="E-mail *" erro={erroCampo('email')}>
            <input
              type="email"
              value={form.email}
              onChange={e => atualizar('email', e.target.value)}
              placeholder="contato@empresa.com"
              className={inputClass(!!erroCampo('email'))}
            />
          </Campo>

          {/* ── Endereço ───────────────────────────────────── */}
          <div className="border border-slate-700/60 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setComEndereco(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/50 hover:bg-slate-800 transition-colors"
            >
              <div className="flex items-center gap-2.5 text-sm font-medium text-slate-300">
                <MapPin size={15} className="text-blue-400" />
                Endereço
                <span className="text-[10px] text-slate-500 font-normal">(opcional)</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                comEndereco ? 'bg-blue-600/20 text-blue-400' : 'bg-slate-700 text-slate-500'
              }`}>
                {comEndereco ? 'ATIVO' : 'IGNORAR'}
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
                          const v = e.target.value.replace(/\D/g, '').slice(0, 8)
                          const fmt = v.length > 5 ? `${v.slice(0,5)}-${v.slice(5)}` : v
                          atualizarEndereco('cep', fmt)
                          if (v.length === 8) buscarCep(v)
                        }}
                        placeholder="00000-000"
                        maxLength={9}
                        className={inputClass(false) + ' pr-8'}
                      />
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                        {buscandoCep
                          ? <Loader2 size={13} className="animate-spin text-blue-400" />
                          : <Search size={13} className="text-slate-600" />}
                      </div>
                    </div>
                  </Campo>
                  <Campo label="Tipo">
                    <select
                      value={endereco.tipo}
                      onChange={e => atualizarEndereco('tipo', e.target.value)}
                      className={inputClass(false)}
                    >
                      <option value="PRINCIPAL">Principal</option>
                      <option value="FILIAL">Filial</option>
                      <option value="COBRANCA">Cobrança</option>
                      <option value="ENTREGA">Entrega</option>
                    </select>
                  </Campo>
                </div>

                <Campo label="Logradouro *">
                  <input
                    value={endereco.logradouro}
                    onChange={e => atualizarEndereco('logradouro', e.target.value)}
                    placeholder="Rua, Avenida, Travessa..."
                    className={inputClass(false)}
                  />
                </Campo>

                <div className="grid grid-cols-2 gap-3">
                  <Campo label="Número *">
                    <input
                      value={endereco.numero}
                      onChange={e => atualizarEndereco('numero', e.target.value)}
                      placeholder="Ex: 100 ou S/N"
                      className={inputClass(false)}
                    />
                  </Campo>
                  <Campo label="Complemento">
                    <input
                      value={endereco.complemento}
                      onChange={e => atualizarEndereco('complemento', e.target.value)}
                      placeholder="Sala, Bloco..."
                      className={inputClass(false)}
                    />
                  </Campo>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Campo label="Bairro *">
                    <input
                      value={endereco.bairro}
                      onChange={e => atualizarEndereco('bairro', e.target.value)}
                      placeholder="Bairro"
                      className={inputClass(false)}
                    />
                  </Campo>
                  <Campo label="Cidade *">
                    <input
                      value={endereco.cidade}
                      onChange={e => atualizarEndereco('cidade', e.target.value)}
                      placeholder="Cidade"
                      className={inputClass(false)}
                    />
                  </Campo>
                  <Campo label="UF *">
                    <input
                      value={endereco.estado}
                      onChange={e => atualizarEndereco('estado', e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="CE"
                      maxLength={2}
                      className={inputClass(false)}
                    />
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
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {enviando ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Cadastrando...
                </>
              ) : (
                'Cadastrar Cliente'
              )}
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

function inputClass(comErro: boolean) {
  return `w-full bg-slate-800 border ${comErro ? 'border-red-500/60' : 'border-slate-700'} text-slate-200 placeholder-slate-500 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 ${comErro ? 'focus:ring-red-500/40' : 'focus:ring-blue-500/40'} transition-all`
}
