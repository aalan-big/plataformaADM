import { DashboardShell } from '@/components/layout'

export default function FinanceiroLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
