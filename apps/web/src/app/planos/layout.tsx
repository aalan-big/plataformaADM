import { DashboardShell } from '@/components/layout'

export default function PlanosLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
