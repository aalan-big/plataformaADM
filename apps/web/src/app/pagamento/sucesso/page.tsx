'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Mail, Key, ArrowRight } from 'lucide-react'
import { LogoStartBig } from '@/components/marca/Marca'

const SITE = 'https://startbig.com.br'

function SucessoConteudo() {
  const sessionId = useSearchParams().get('session_id')

  const passos = [
    {
      Icone: Mail,
      titulo: 'Verifique seu e-mail',
      texto:  'Enviamos a chave de ativação para o e-mail cadastrado. Pode levar alguns minutos para chegar.',
    },
    {
      Icone: Key,
      titulo: 'Ative no sistema',
      texto:  'Abra o StartBIG ERP, vá em Configurações → Licença e informe a chave recebida.',
    },
  ]

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
        <div className="text-center space-y-4 mb-9">
          <div className="w-16 h-16 rounded-full bg-[#10B981]/10 border-2 border-[#10B981]/25 flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-[#10B981]" />
          </div>
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#151515] tracking-tight">
              Pagamento confirmado
            </h1>
            <p className="text-[#64748B] mt-2">Sua licença já está ativa. Falta só ativar no sistema.</p>
          </div>
        </div>

        {/* Próximos passos numerados: o cliente acabou de pagar e precisa saber
            exatamente o que fazer agora, sem procurar. */}
        <div className="space-y-3">
          {passos.map(({ Icone, titulo, texto }, i) => (
            <div key={titulo} className="flex items-start gap-4 bg-white border border-[#E9E9E9] rounded-2xl px-5 py-5 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-[#E7F1FA] flex items-center justify-center shrink-0">
                <Icone size={17} className="text-[#045CA1]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#151515]">
                  <span className="text-[#045CA1]">{i + 1}.</span> {titulo}
                </p>
                <p className="text-sm text-[#64748B] mt-1 leading-relaxed">{texto}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-[#F8F7FF] border border-[#E9E9E9] rounded-2xl px-5 py-5 mt-6 text-center">
          <p className="text-sm text-[#334155]">
            Ainda não instalou o StartBIG?
          </p>
          <a
            href={`${SITE}#download`}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-[#045CA1] hover:text-[#034A82] mt-1.5 transition-colors"
          >
            Baixar o sistema <ArrowRight size={14} />
          </a>
        </div>

        {sessionId && (
          <p className="text-[11px] text-[#94A3B8] font-mono text-center mt-8">
            Ref: {sessionId.slice(0, 28)}…
          </p>
        )}

        <p className="text-xs text-[#64748B] text-center mt-3">
          Dúvidas? Fale com o suporte pelo site.
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

export default function PagamentoSucessoPage() {
  return (
    <Suspense>
      <SucessoConteudo />
    </Suspense>
  )
}
