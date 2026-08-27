import { DashboardShell } from '@/components/layout'

export default function ModulosLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
