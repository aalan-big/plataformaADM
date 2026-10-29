import { DashboardShell } from '@/components/layout'

export default function FiscalLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
