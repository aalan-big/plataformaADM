import { Sidebar, Header } from '@/components/layout'

export default function FinanceiroLayout({ children }: { children: React.ReactNode }) {
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
