'use client'

import { useState, type ReactNode } from 'react'

export function Tema({ titulo, children }: { titulo: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(true)

  return (
    <div className="border border-slate-700/60 rounded-2xl overflow-hidden">
      <button
        onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between px-6 py-4 bg-slate-800/60 hover:bg-slate-800 transition text-left"
      >
        <span className="text-xs font-black text-slate-300 uppercase tracking-widest">{titulo}</span>
        <span className="text-slate-500 text-sm">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-slate-700/30">
          {children}
        </div>
      )}
    </div>
  )
}
