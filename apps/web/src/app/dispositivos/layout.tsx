/*
 * ARQUIVO: Layout do Módulo de Dispositivos (layout.tsx)
 * POSIÇÃO: src/app/dispositivos/layout.tsx
 *
 * Mesma estrutura de layout do painel (Sidebar + Header + main) aplicada
 * ao módulo de Dispositivos/Licenças. Cada módulo tem seu próprio layout
 * para que o Next.js possa aplicar loading states e error boundaries
 * independentemente por módulo.
 */
import { Sidebar, Header } from '@/components/layout'

export default function DispositivosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-[#0f172a] p-6">{children}</main>
      </div>
    </div>
  )
}