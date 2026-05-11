'use client'

import { useState, type ReactNode } from 'react'

interface TemaProps {
  titulo: string
  children: ReactNode
}

export function Tema({ titulo, children }: TemaProps) {
  const [aberto, setAberto] = useState(true)

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setAberto(!aberto)}
        className="w-full flex items-center justify-between px-6 py-4 bg-[#1e293b] hover:bg-[#263347] transition text-left"
      >
        <span className="text-slate-200 font-bold text-sm uppercase tracking-widest">{titulo}</span>
        <span className="text-slate-400 text-lg">{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-[#0f172a]">
          {children}
        </div>
      )}
    </div>
  )
}
