export const metadata = {
  title:       'Contratar — StartBig ERP',
  description: 'Escolha o período e comece a usar o StartBig ERP hoje.',
}

/**
 * Página pública: sem DashboardShell, sem menu, sem exigir login. É a primeira
 * tela que um cliente novo vê, vinda do site.
 */
export default function ContratarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-950 text-white px-4 py-10 flex justify-center">
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  )
}
