'use client'

import { XCircle, ArrowLeft } from 'lucide-react'
import { LogoStartBig } from '@/components/marca/Marca'

const SITE = 'https://startbig.com.br'

export default function PagamentoCanceladoPage() {
  return (
    <>
      <header className="border-b border-[#E9E9E9] bg-white">
        <div className="max-w-2xl mx-auto px-5 h-16 flex items-center justify-between">
          <LogoStartBig />
          <a href={SITE} className="text-sm font-medium text-[#64748B] hover:text-[#045CA1] transition-colors">
            Ir para o site
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-12 sm:py-16">
        <div className="text-center space-y-4 mb-8">
          <div className="w-16 h-16 rounded-full bg-[#FEF3C7] border-2 border-[#FDE68A] flex items-center justify-center mx-auto">
            <XCircle size={32} className="text-[#B45309]" />
          </div>
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#151515] tracking-tight">
              Pagamento não concluído
            </h1>
            <p className="text-[#64748B] mt-2">Nenhuma cobrança foi feita no seu cartão.</p>
          </div>
        </div>

        <div className="bg-white border border-[#E9E9E9] rounded-2xl px-6 py-6 shadow-sm space-y-3">
          <p className="text-sm text-[#334155] leading-relaxed">
            Você saiu antes de finalizar, e está tudo bem — sua conta e sua licença continuam exatamente como estavam.
          </p>
          {/* Quem chegou até aqui já se cadastrou: dizer que o acesso continua
              de pé evita que ele ache que perdeu o que preencheu. */}
          <p className="text-sm text-[#334155] leading-relaxed">
            Se você já tinha criado sua conta, ela segue ativa e você pode entrar no sistema normalmente.
            Para concluir a assinatura, é só voltar e escolher o período de novo.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <a
            href="/contratar"
            className="flex-1 flex items-center justify-center gap-2 bg-[#045CA1] hover:bg-[#034A82] text-white font-bold py-3.5 rounded-xl transition-colors text-sm"
          >
            <ArrowLeft size={15} /> Voltar e assinar
          </a>
          <a
            href={SITE}
            className="flex-1 flex items-center justify-center border border-[#E9E9E9] text-[#334155] hover:bg-[#F8F7FF] font-semibold py-3.5 rounded-xl transition-colors text-sm"
          >
            Ir para o site
          </a>
        </div>

        <p className="text-xs text-[#64748B] text-center mt-6">
          Teve algum problema no pagamento? Fale com o suporte que a gente resolve.
        </p>
      </main>

      <footer className="border-t border-[#E9E9E9] mt-8">
        <div className="max-w-2xl mx-auto px-5 py-6 text-center">
          <p className="text-xs text-[#64748B]">© 2026 StartBIG · Desenvolvido por BIG TEC</p>
        </div>
      </footer>
    </>
  )
}
