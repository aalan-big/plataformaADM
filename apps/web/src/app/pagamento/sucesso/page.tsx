'use client'

import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Mail, Key } from 'lucide-react'
import { Suspense } from 'react'

function SucessoContent() {
  const params    = useSearchParams()
  const sessionId = params.get('session_id')

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl">

        <div className="bg-emerald-600/15 border-b border-emerald-500/20 px-8 py-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">Pagamento confirmado!</h1>
          <p className="text-emerald-400/80 text-sm">Sua licença foi renovada com sucesso.</p>
        </div>

        <div className="px-8 py-6 space-y-4">
          <div className="flex items-start gap-3 bg-slate-800/60 rounded-xl p-4">
            <Mail size={16} className="text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-200">Verifique seu e-mail</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Enviamos a nova chave de ativação para o e-mail cadastrado. Pode levar alguns minutos.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-slate-800/60 rounded-xl p-4">
            <Key size={16} className="text-purple-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-200">Ative no sistema</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Abra o StartBig ERP, vá em <strong className="text-slate-300">Configurações → Licença</strong> e insira a chave recebida por e-mail.
              </p>
            </div>
          </div>

          {sessionId && (
            <p className="text-[11px] text-slate-600 font-mono text-center pt-1">
              Ref: {sessionId.slice(0, 24)}…
            </p>
          )}
        </div>

        <div className="px-8 pb-6">
          <p className="text-xs text-slate-500 text-center">
            Dúvidas? Entre em contato com o suporte.
          </p>
        </div>

      </div>
    </div>
  )
}

export default function PagamentoSucessoPage() {
  return (
    <Suspense>
      <SucessoContent />
    </Suspense>
  )
}
