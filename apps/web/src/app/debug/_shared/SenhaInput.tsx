'use client'

import { useState, type ChangeEvent } from 'react'

interface Props {
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  name?: string
}

export function SenhaInput({ value, onChange, placeholder = '••••••••', name }: Props) {
  const [ver, setVer] = useState(false)

  return (
    <div className="relative">
      <input
        type={ver ? 'text' : 'password'}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 text-xs rounded-lg px-3 py-2 pr-9 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
      />
      <button
        type="button"
        onClick={() => setVer(v => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-sm"
        tabIndex={-1}
      >
        {ver ? '🙈' : '👁'}
      </button>
    </div>
  )
}
