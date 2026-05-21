'use client'

import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarAberta, setSidebarAberta] = useState(false)

  return (
    <div className="flex h-dvh bg-gray-950 text-white overflow-hidden">
      <Sidebar aberta={sidebarAberta} onFechar={() => setSidebarAberta(false)} />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header onAbrirMenu={() => setSidebarAberta(true)} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
