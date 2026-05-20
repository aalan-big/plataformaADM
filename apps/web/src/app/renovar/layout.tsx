import type { ReactNode } from 'react'

export default function RenovarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
      {children}
    </div>
  )
}
