'use client'

import { useEffect, useState } from 'react'
import { Bell, MessageSquare } from 'lucide-react'

export function Header() {
  const [nome, setNome] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem('user_data')
      if (raw) {
        const user = JSON.parse(raw)
        setNome(user.nome ?? user.email ?? '')
      }
    } catch { /* ignore */ }
  }, [])

  const iniciais = nome
    ? nome.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-6 bg-slate-900 border-b border-slate-800">
      <div />

      <div className="flex items-center gap-2">
        <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors">
          <Bell size={16} />
        </button>
        <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors">
          <MessageSquare size={16} />
        </button>

        <div className="ml-1 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <span className="text-blue-400 text-xs font-bold">{iniciais}</span>
          </div>
          {nome && <span className="text-slate-300 text-sm font-medium hidden lg:block">{nome}</span>}
        </div>
      </div>
    </header>
  )
}
