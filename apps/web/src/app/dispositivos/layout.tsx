import { DashboardShell } from '@/components/layout'

export default function DispositivosLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
