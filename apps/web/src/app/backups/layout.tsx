import { DashboardShell } from '@/components/layout'

export default function BackupsLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
