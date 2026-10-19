import { DashboardShell } from '@/components/layout'

export default function EmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
