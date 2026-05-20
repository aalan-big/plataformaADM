'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Eye, Pencil, Users, PowerOff, CreditCard } from 'lucide-react'
import ModalCriarCliente from './_components/ModalCriarCliente'
import ModalEditarCliente from './_components/ModalEditarCliente'
import ModalConfirmarDesativacao from './_components/ModalConfirmarDesativacao'
import ModalPerfilCliente from './_components/ModalPerfilCliente'
import ModalGerarLinkCliente from './_components/ModalGerarLinkCliente'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Cliente = {
  id: string
  tipo: 'PF' | 'PJ'
  email: string
  usuarioId: string
  parceiroId?: string | null
  criadoEm: string
  pf: { nomeCompleto: string; cpf: string } | null
  pj: { razaoSocial: string; cnpj: string; nomeFantasia?: string | null } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nomeCliente(c: Cliente) {
  return c.tipo === 'PF' ? (c.pf?.nomeCompleto ?? '—') : (c.pj?.razaoSocial ?? '—')
}

function docCliente(c: Cliente) {
  if (c.tipo === 'PF') return formatCpf(c.pf?.cpf ?? '')
  return formatCnpj(c.pj?.cnpj ?? '')
}

function formatCpf(v: string) {
  return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

function formatCnpj(v: string) {
  return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

function formatarData(iso: string) {
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2,'0')} ${meses[d.getMonth()]} ${d.getFullYear()}`
}

const PALETA = [
  'bg-blue-600', 'bg-emerald-600', 'bg-purple-600',
  'bg-orange-500', 'bg-pink-600', 'bg-cyan-600',
  'bg-indigo-600', 'bg-rose-600', 'bg-teal-600',
]

function corAvatar(nome: string) {
  return PALETA[(nome.charCodeAt(0) || 0) % PALETA.length]
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [modalAberto, setModalAberto]               = useState(false)
  const [clienteEditando, setClienteEditando]       = useState<Cliente | null>(null)
  const [clientePerfil, setClientePerfil]           = useState<string | null>(null)
  const [clienteRemovendo, setClienteRemovendo]     = useState<Cliente | null>(null)
  const [clienteGerandoLink, setClienteGerandoLink] = useState<Cliente | null>(null)
  const [processandoId, setProcessandoId]           = useState<string | null>(null)

  const carregar = useCallback(async (q = '') => {
    setCarregando(true)
    try {
      const url = q ? `/api/cliente?q=${encodeURIComponent(q)}` : '/api/cliente'
      const res = await fetch(url)
      const json = await res.json()
      setClientes(json.data ?? [])
    } catch {
      setClientes([])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    if (busca === '') {
      carregar('')
      return
    }
    const t = setTimeout(() => carregar(busca), 400)
    return () => clearTimeout(t)
  }, [busca, carregar])

  async function remover(id: string) {
    setProcessandoId(id)
    try {
      await fetch(`/api/cliente/${id}/desativar`, { method: 'PATCH' })
      await carregar(busca)
      setClienteRemovendo(null)
      setClientePerfil(null)
    } finally {
      setProcessandoId(null)
    }
  }

  return (
    <div className="space-y-5">

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-blue-950 border border-slate-800 p-8">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-linear-to-l from-blue-950/60 to-transparent pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-[0.25em] mb-1.5">
              Gestão de Clientes
            </p>
            <h1 className="text-3xl font-extrabold text-white uppercase tracking-wide">
              Clientes
            </h1>
          </div>

          <div className="flex items-stretch gap-3 shrink-0">
            <div className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-6 py-4 text-center min-w-25">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Users size={12} className="text-slate-400" />
                <p className="text-[11px] text-slate-400 uppercase tracking-wide">Total</p>
              </div>
              <p className="text-3xl font-extrabold text-white">
                {carregando ? '—' : clientes.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── FILTROS ──────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-50 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Pesquisar por nome, CPF, CNPJ, e-mail..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
          />
        </div>

        <button
          onClick={() => setModalAberto(true)}
          className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors shadow-lg shadow-blue-900/30"
        >
          <Plus size={14} />
          Adicionar Cliente
        </button>
      </div>

      {/* ── TABELA ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Cliente</th>
                <th className="text-left px-5 py-3 font-semibold">CPF / CNPJ</th>
                <th className="text-left px-5 py-3 font-semibold">E-mail</th>
                <th className="text-left px-5 py-3 font-semibold">Cadastrado em</th>
                <th className="text-left px-5 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">

              {carregando && (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-slate-500 text-xs">Carregando clientes...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!carregando && clientes.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2">
                      <Users size={28} className="text-slate-700" />
                      <p className="text-slate-500 text-sm">
                        {busca ? 'Nenhum cliente encontrado com esses filtros.' : 'Nenhum cliente cadastrado ainda.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {!carregando && clientes.map(c => {
                const nome = nomeCliente(c)
                return (
                  <tr key={c.id} onClick={() => setClientePerfil(c.id)} className="hover:bg-slate-800/40 transition-colors group cursor-pointer">

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full ${corAvatar(nome)} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
                          {nome[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-200 leading-tight">{nome}</p>
                          <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            c.tipo === 'PJ'
                              ? 'bg-blue-500/15 text-blue-400'
                              : 'bg-purple-500/15 text-purple-400'
                          }`}>
                            {c.tipo}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-4 text-slate-400 font-mono text-xs">
                      {docCliente(c)}
                    </td>

                    <td className="px-5 py-4 text-slate-300 text-sm">
                      {c.email}
                    </td>

                    <td className="px-5 py-4 text-slate-400 text-xs">
                      {formatarData(c.criadoEm)}
                    </td>

                    <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button
                          onClick={() => setClientePerfil(c.id)}
                          title="Ver perfil completo"
                          className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => setClienteEditando(c)}
                          title="Editar cliente"
                          className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-600/15 rounded-lg transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setClienteGerandoLink(c)}
                          title="Gerar link de pagamento"
                          className="p-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/15 rounded-lg transition-colors"
                        >
                          <CreditCard size={14} />
                        </button>
                        <button
                          onClick={() => setClienteRemovendo(c)}
                          disabled={processandoId === c.id}
                          title="Remover cliente"
                          className="p-2 text-orange-400 hover:text-orange-300 hover:bg-orange-500/15 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <PowerOff size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!carregando && clientes.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-800">
            <p className="text-xs text-slate-500">
              <span className="text-slate-300 font-medium">{clientes.length}</span> cliente{clientes.length !== 1 ? 's' : ''} cadastrado{clientes.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>

      {modalAberto && (
        <ModalCriarCliente
          onClose={() => setModalAberto(false)}
          onSuccess={() => { setModalAberto(false); carregar(busca) }}
        />
      )}

      {clienteEditando && (
        <ModalEditarCliente
          cliente={clienteEditando}
          onClose={() => setClienteEditando(null)}
          onSuccess={() => { setClienteEditando(null); carregar(busca) }}
        />
      )}

      {clientePerfil && (
        <ModalPerfilCliente
          clienteId={clientePerfil}
          onClose={() => setClientePerfil(null)}
          onEditar={(c) => {
            setClientePerfil(null)
            setClienteEditando(c as unknown as Cliente)
          }}
          onDesativar={(c) => {
            setClientePerfil(null)
            setClienteRemovendo(c as unknown as Cliente)
          }}
          onReativar={async () => { setClientePerfil(null) }}
        />
      )}

      {clienteGerandoLink && (
        <ModalGerarLinkCliente
          clienteId={clienteGerandoLink.id}
          nomeCliente={nomeCliente(clienteGerandoLink)}
          onClose={() => setClienteGerandoLink(null)}
        />
      )}

      {clienteRemovendo && (
        <ModalConfirmarDesativacao
          nomeCliente={
            clienteRemovendo.tipo === 'PF'
              ? (clienteRemovendo.pf?.nomeCompleto ?? clienteRemovendo.email)
              : (clienteRemovendo.pj?.razaoSocial  ?? clienteRemovendo.email)
          }
          processando={processandoId === clienteRemovendo.id}
          onConfirmar={() => remover(clienteRemovendo.id)}
          onCancelar={() => setClienteRemovendo(null)}
        />
      )}
    </div>
  )
}
