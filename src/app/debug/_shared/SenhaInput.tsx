'use client'

import { useState, type ChangeEvent } from 'react'

interface SenhaInputProps {
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}

export function SenhaInput({ value, onChange }: SenhaInputProps) {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <input
        className="w-full bg-[#0f172a] border border-slate-600 rounded p-2 pr-10 focus:border-cyan-500 outline-none transition"
        type={show ? 'text' : 'password'}
        placeholder="******"
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-cyan-400 transition-colors"
      >
        {show ? '🙈' : '👁️'}
      </button>
    </div>
  )
}
