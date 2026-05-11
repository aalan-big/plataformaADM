'use client'

import { XCircle } from 'lucide-react'

export default function PagamentoCanceladoPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl">

        <div className="bg-orange-500/10 border-b border-orange-500/20 px-8 py-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-orange-500/15 border border-orange-500/25 flex items-center justify-center">
              <XCircle size={32} className="text-orange-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">Pagamento cancelado</h1>
          <p className="text-orange-400/80 text-sm">Nenhuma cobrança foi realizada.</p>
        </div>

        <div className="px-8 py-6 space-y-3">
          <p className="text-sm text-slate-300 text-center leading-relaxed">
            Você cancelou o processo de pagamento. Sua licença atual não foi alterada.
          </p>
          <p className="text-xs text-slate-500 text-center">
            Se precisar renovar ou tiver dúvidas, entre em contato com o suporte ou tente novamente pelo link enviado.
          </p>
        </div>

        <div className="px-8 pb-6">
          <button
            onClick={() => window.close()}
            className="w-full py-2.5 text-sm text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  )
}
