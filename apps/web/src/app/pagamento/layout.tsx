export const metadata = {
  title: 'Pagamento — StartBig ERP',
}

/**
 * Retorno do Stripe. Tema CLARO, igual ao site e à página de contratação: o
 * cliente acabou de sair de uma tela clara e não pode ter a impressão de ter
 * caído em outro lugar bem na confirmação do pagamento.
 */
export default function PagamentoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white text-[#334155] antialiased">
      {children}
    </div>
  )
}
