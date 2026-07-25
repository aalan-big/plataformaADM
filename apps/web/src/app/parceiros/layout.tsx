import { DashboardShell } from '@/components/layout'

export default function ParceirosLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
