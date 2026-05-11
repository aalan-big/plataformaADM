'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Cpu,
  Handshake,
  UserCog,
  Wrench,
  Wallet,
  LogOut,
  ChevronRight,
  Crown,
} from 'lucide-react'

const secoes = [
  {
    titulo: 'Principal',
    itens: [
      { label: 'Dashboard',        icone: LayoutDashboard, href: '/dashboard' },
    ],
  },
  {
    titulo: 'Gestão',
    itens: [
      { label: 'Clientes',          icone: Users,      href: '/clientes'  },
      { label: 'Dispositivos',      icone: Cpu,        href: '#'          },
      { label: 'Parceiros',         icone: Handshake,  href: '#'          },
      { label: 'Equipe',            icone: UserCog,    href: '#'          },
      { label: 'Planos',            icone: Crown,      href: '#'          },
    ],
  },
  {
    titulo: 'Operações',
    itens: [
      { label: 'Suporte Técnico',   icone: Wrench,     href: '#'          },
      { label: 'Financeiro',        icone: Wallet,     href: '#'          },
    ],
  },
]

export function Sidebar() {
  const router   = useRouter()
  const pathname = usePathname()
  const [nomeUsuario, setNomeUsuario] = useState('')

  useEffect(() => {
    try {
      const dados = localStorage.getItem('user_data')
      if (!dados) return
      const u = JSON.parse(dados)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (u?.nome) setNomeUsuario(u.nome)
    } catch { /* ignora */ }
  }, [])

  const iniciais = nomeUsuario
    ? nomeUsuario.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : 'AD'

  function navegar(href: string) {
    if (href !== '#') router.push(href)
  }

  async function sair() {
    await fetch('/api/auth/logout', { method: 'POST' })
    localStorage.removeItem('user_data')
    router.push('/login')
  }

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800/60 hidden md:flex flex-col h-screen shrink-0">

      {/* Logo */}
      <div className="px-5 py-6 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-linear-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-900/40 shrink-0">
            <span className="text-white font-black text-sm tracking-tight">SB</span>
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight tracking-wide">Start Big</p>
            <p className="text-[10px] text-slate-500 font-medium">Plataforma de Controle</p>
          </div>
        </div>
      </div>

      {/* Navegação */}
      <nav className="flex-1 overflow-y-auto scrollbar-none px-3 py-4 space-y-5" style={{ scrollbarWidth: 'none' }}>
        {secoes.map(({ titulo, itens }) => (
          <div key={titulo}>
            <p className="px-3 mb-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-[0.2em]">
              {titulo}
            </p>
            <div className="space-y-0.5">
              {itens.map(({ label, icone: Icone, href }) => {
                const ativo    = href !== '#' && pathname.startsWith(href)
                const bloqueado = href === '#'

                return (
                  <button
                    key={label}
                    onClick={() => navegar(href)}
                    disabled={bloqueado}
                    className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group/item ${
                      ativo
                        ? 'bg-blue-600/15 text-blue-400 font-semibold'
                        : bloqueado
                          ? 'text-slate-700 cursor-not-allowed'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 cursor-pointer'
                    }`}
                  >
                    <span className={`absolute left-3 w-0.5 h-5 rounded-full bg-blue-500 transition-opacity ${ativo ? 'opacity-100' : 'opacity-0'}`} />

                    <Icone size={16} className={`shrink-0 ${ativo ? 'text-blue-400' : bloqueado ? 'text-slate-700' : 'text-slate-500 group-hover/item:text-slate-300'}`} />

                    <span className="flex-1 text-left">{label}</span>

                    {bloqueado && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-600 border border-slate-700/50">
                        BREVE
                      </span>
                    )}

                    {ativo && (
                      <ChevronRight size={12} className="text-blue-500 shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Usuário + Sair */}
      <div className="p-3 border-t border-slate-800/60 space-y-1">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-900/60">
          <div className="w-8 h-8 rounded-full bg-linear-to-tr from-blue-600 to-blue-400 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow border border-blue-500/20">
            {iniciais}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-200 truncate">{nomeUsuario || 'Administrador'}</p>
            <p className="text-[10px] text-slate-500">BigTec · Admin</p>
          </div>
        </div>

        <button
          onClick={sair}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-500 hover:text-red-400 hover:bg-red-400/8 rounded-xl transition-colors group/sair"
        >
          <LogOut size={15} className="shrink-0 group-hover/sair:text-red-400" />
          Sair do sistema
        </button>
      </div>
    </aside>
  )
}
