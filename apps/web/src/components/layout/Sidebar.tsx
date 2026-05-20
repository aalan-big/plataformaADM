'use client'

import { useRouter, usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Cpu, DollarSign, Mail, LogOut } from 'lucide-react'

const itens = [
  { label: 'Dashboard',   href: '/dashboard',   Icone: LayoutDashboard },
  { label: 'Clientes',    href: '/clientes',     Icone: Users           },
  { label: 'Dispositivos', href: '/dispositivos', Icone: Cpu            },
  { label: 'Financeiro',  href: '/financeiro',   Icone: DollarSign      },
  { label: 'E-mails',     href: '/email',        Icone: Mail            },
]

export function Sidebar() {
  const router   = useRouter()
  const pathname = usePathname()

  async function sair() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch { /* ignore */ }
    localStorage.removeItem('user_data')
    router.push('/login')
  }

  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col bg-slate-900 border-r border-slate-800 h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <span className="text-white font-black text-xs">SB</span>
        </div>
        <div className="leading-tight">
          <p className="text-white font-bold text-sm">StartBig</p>
          <p className="text-slate-500 text-[10px]">Admin</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {itens.map(({ label, href, Icone }) => {
          const ativo = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <button
              key={href}
              onClick={() => router.push(href)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                ativo
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Icone size={16} className="shrink-0" />
              {label}
              {ativo && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400" />}
            </button>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-slate-800">
        <button
          onClick={sair}
          className="btn-sair w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-red-500/10"
        >
          <LogOut size={16} className="icon-sair shrink-0" />
          Sair
        </button>
      </div>
    </aside>
  )
}
