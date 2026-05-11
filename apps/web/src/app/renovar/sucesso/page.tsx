'use client'

import { CheckCircle2, Mail, Cpu } from 'lucide-react'
import Link from 'next/link'

export default function RenovarSucessoPage() {
  return (
    <div className="w-full max-w-md">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-8 text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 size={40} className="text-emerald-400" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">Pagamento realizado!</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Processando sua licença. Em instantes você receberá um e-mail com a chave de ativação.
          </p>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3 text-left">
          <div className="flex items-start gap-3">
            <Mail size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Verifique seu e-mail</p>
              <p className="text-xs text-slate-400 mt-0.5">A chave de ativação será enviada para o e-mail cadastrado. Verifique também a caixa de spam.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Cpu size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Ative no aplicativo</p>
              <p className="text-xs text-slate-400 mt-0.5">Abra o sistema, vá em <span className="font-mono text-slate-300">Configurações → Ativar Licença</span> e insira a chave recebida.</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-600">
          Dúvidas? Entre em contato com o suporte.
        </p>
      </div>
    </div>
  )
}
