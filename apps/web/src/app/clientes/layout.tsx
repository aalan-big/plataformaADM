import { DashboardShell } from '@/components/layout'

export default function ClientesLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
