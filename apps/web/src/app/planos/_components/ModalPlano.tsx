'use client'

import { useState } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import type { Plano } from '../_tipos'

const campo = 'w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40'
const rotulo = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide'

const vazio = {
  nome: '', descricaoCheckout: '', limiteUsuario: '1',
  precoMensal: '', precoTrimestral: '', precoAnual: '',
  valorLicencaAdicional: '', descontoTrimestral: '', descontoAnual: '',
}

function paraFormulario(p: Plano | null): typeof vazio {
  if (!p) return vazio
  const num = (v: number | string | null) => (v != null ? String(Number(v)) : '')
  return {
    nome:                  p.nome,
    descricaoCheckout:     p.descricaoCheckout ?? '',
    limiteUsuario:         String(p.limiteUsuario),
    precoMensal:           num(p.precoMensal),
    precoTrimestral:       num(p.precoTrimestral),
    precoAnual:            num(p.precoAnual),
    valorLicencaAdicional: num(p.valorLicencaAdicional),
    descontoTrimestral:    num(p.descontoTrimestral),
    descontoAnual:         num(p.descontoAnual),
  }
}

export function ModalPlano({
  plano, onClose, onSalvo,
}: {
  plano:    Plano | null      // null = criando
  onClose:  () => void
  onSalvo:  () => void
}) {
  const [form, setForm]         = useState(paraFormulario(plano))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState('')

  const set = (k: keyof typeof vazio, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const numeroOuOmitir = (v: string) => (v.trim() === '' ? undefined : Number(v))

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      const body = {
        nome:          form.nome.trim(),
        limiteUsuario: parseInt(form.limiteUsuario) || 1,
        precoMensal:   Number(form.precoMensal) || 0,
        ...(form.descricaoCheckout.trim()   ? { descricaoCheckout:     form.descricaoCheckout.trim() }        : {}),
        ...(numeroOuOmitir(form.precoTrimestral)       != null ? { precoTrimestral:       Number(form.precoTrimestral) }       : {}),
        ...(numeroOuOmitir(form.precoAnual)            != null ? { precoAnual:            Number(form.precoAnual) }            : {}),
        ...(numeroOuOmitir(form.valorLicencaAdicional) != null ? { valorLicencaAdicional: Number(form.valorLicencaAdicional) } : {}),
        ...(numeroOuOmitir(form.descontoTrimestral)    != null ? { descontoTrimestral:    Number(form.descontoTrimestral) }    : {}),
        ...(numeroOuOmitir(form.descontoAnual)         != null ? { descontoAnual:         Number(form.descontoAnual) }         : {}),
      }

      const res = await fetch(plano ? `/api/plano/${plano.id}` : '/api/plano', {
        method:  plano ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Não foi possível salvar o plano.')

      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSalvando(false)
    }
  }

  const precoInvalido = !form.precoMensal || Number(form.precoMensal) <= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="font-bold text-white">{plano ? `Editar ${plano.nome}` : 'Novo Plano'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <label className={rotulo}>Nome do plano *</label>
              <input className={campo} value={form.nome} placeholder="Ex.: Plano Start"
                onChange={e => set('nome', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className={rotulo}>Limite de usuários *</label>
              <input className={campo} type="number" min={1} value={form.limiteUsuario}
                onChange={e => set('limiteUsuario', e.target.value)} />
            </div>
          </div>

          {/* Descrição que o cliente lê no checkout */}
          <div className="space-y-1.5">
            <label className={rotulo}>Descrição exibida no checkout</label>
            <textarea
              className={`${campo} h-24 resize-y`}
              maxLength={500}
              value={form.descricaoCheckout}
              placeholder="O que o cliente lê abaixo do preço, na hora de pagar. Ex.: Gestão completa da sua loja: PDV e vendas, ordens de serviço, estoque..."
              onChange={e => set('descricaoCheckout', e.target.value)}
            />
            <p className="text-[11px] text-slate-500">
              {form.descricaoCheckout.length}/500 — texto <strong className="text-amber-400">público</strong>, aparece para
              quem vai pagar. Nada de margem de parceiro, custo ou canal de venda. Só chega ao Stripe depois de
              você clicar em <strong className="text-purple-400">Sincronizar Stripe</strong>.
            </p>
          </div>

          {/* Preços */}
          <div className="space-y-3">
            <p className={rotulo}>Preços</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Mensal (R$) *</label>
                <input className={campo} type="number" step="0.01" min={0} value={form.precoMensal}
                  placeholder="0,00" onChange={e => set('precoMensal', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Trimestral (R$)</label>
                <input className={campo} type="number" step="0.01" min={0} value={form.precoTrimestral}
                  placeholder="Opcional" onChange={e => set('precoTrimestral', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Anual (R$)</label>
                <input className={campo} type="number" step="0.01" min={0} value={form.precoAnual}
                  placeholder="Opcional" onChange={e => set('precoAnual', e.target.value)} />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Período deixado em branco não é oferecido ao cliente na tela de pagamento.
            </p>
          </div>

          {/* Complementares */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Licença adicional (R$)</label>
              <input className={campo} type="number" step="0.01" min={0} value={form.valorLicencaAdicional}
                placeholder="Opcional" onChange={e => set('valorLicencaAdicional', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Desconto trimestral (%)</label>
              <input className={campo} type="number" min={0} max={100} value={form.descontoTrimestral}
                placeholder="Opcional" onChange={e => set('descontoTrimestral', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Desconto anual (%)</label>
              <input className={campo} type="number" min={0} max={100} value={form.descontoAnual}
                placeholder="Opcional" onChange={e => set('descontoAnual', e.target.value)} />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 border-t border-slate-800 pt-4 leading-relaxed">
            Os descontos só entram na conta quando o preço do período está em branco — havendo preço fechado,
            é ele que vale, porque é ele que corresponde ao valor cobrado pelo Stripe.
          </p>

          {erro && (
            <div className="flex items-start gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-sm">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {erro}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando || !form.nome.trim() || precoInvalido}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors"
          >
            {salvando ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : plano ? 'Salvar alterações' : 'Criar plano'}
          </button>
        </div>
      </div>
    </div>
  )
}
