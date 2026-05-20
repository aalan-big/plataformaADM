'use client'

import { AlertTriangle, Loader2, X } from 'lucide-react'

interface Props {
  nomeCliente: string
  processando: boolean
  onConfirmar: () => void
  onCancelar:  () => void
}

export default function ModalConfirmarDesativacao({ nomeCliente, processando, onConfirmar, onCancelar }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={processando ? undefined : onCancelar} />

      <div className="relative z-10 w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-orange-400">
            <AlertTriangle size={16} />
            <h2 className="font-bold text-white">Remover cliente</h2>
          </div>
          <button
            onClick={onCancelar}
            disabled={processando}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-4">
          <div className="flex items-start gap-3 bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
            <AlertTriangle size={18} className="text-orange-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-200">
                Tem certeza que deseja remover <span className="text-orange-300">{nomeCliente}</span>?
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Esta ação desativará o acesso do cliente à plataforma. Os dados serão preservados.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
          <button
            onClick={onCancelar}
            disabled={processando}
            className="px-4 py-2 text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={processando}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {processando ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
            {processando ? 'Removendo...' : 'Confirmar remoção'}
          </button>
        </div>
      </div>
    </div>
  )
}
