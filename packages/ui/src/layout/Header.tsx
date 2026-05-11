'use client'

import React, { useEffect, useState } from 'react'

export function Header() {
  const [nomeUsuario, setNomeUsuario] = useState('')

  useEffect(() => {
    try {
      const dadosBrutos = localStorage.getItem('user_data')
      if (!dadosBrutos) return
      const usuario = JSON.parse(dadosBrutos)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (usuario?.nome) setNomeUsuario(usuario.nome)
    } catch {
      // localStorage corrompido — ignora
    }
  }, [])

  const iniciais = nomeUsuario
    ? nomeUsuario.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '..'

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900 flex items-center justify-between px-8">
      <div className="flex flex-col">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-tighter">
          Bem-vindo de volta
        </span>
        <span className="text-sm text-slate-200 font-semibold">
          {nomeUsuario || 'Carregando...'}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-xs font-bold text-slate-200">BigTec</span>
          <span className="text-[10px] text-green-500 font-medium text-right">Unidade Iguatu</span>
        </div>

        <div className="w-10 h-10 rounded-full bg-linear-to-tr from-blue-600 to-blue-400 flex items-center justify-center text-sm font-bold shadow-lg border border-blue-400/20">
          {iniciais}
        </div>
      </div>
    </header>
  )
}
