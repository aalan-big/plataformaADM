export const metadata = {
  title:       'Contratar — StartBig ERP',
  description: 'Escolha o período e comece a usar o StartBig ERP hoje.',
}

/**
 * Página pública: sem DashboardShell, sem menu, sem exigir login.
 *
 * Tema CLARO de propósito, seguindo os tokens do site de divulgação. O cliente
 * chega aqui vindo de startbig.com.br — mudar para o tema escuro do painel no
 * meio da compra dá a sensação de ter sido jogado para fora do site, justo no
 * momento em que ele precisa confiar para digitar CPF e senha.
 */
export default function ContratarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white text-[#334155] antialiased">
      {children}
    </div>
  )
}
