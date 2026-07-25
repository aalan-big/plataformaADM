'use client'

import { useState } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import type { Parceiro } from '../_tipos'

const campo  = 'w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500/40'
const rotulo = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide'

const vazio = {
  codigo: '', nomeParceiro: '', documento: '', email: '', contatoCelular: '', cidadeBase: '',
  tipoComissao: 'FIXO_MENSAL', valorComissaoFixa: '30', comissaoPercentual: '', observacoes: '',
}

function paraFormulario(p: Parceiro | null): typeof vazio {
  if (!p) return vazio
  const num = (v: number | string | null) => (v != null ? String(Number(v)) : '')
  return {
    codigo:             p.codigo,
    nomeParceiro:       p.nomeParceiro,
    documento:          p.documento ?? '',
    email:              p.email ?? '',
    contatoCelular:     p.contatoCelular ?? '',
    cidadeBase:         p.cidadeBase ?? '',
    tipoComissao:       p.tipoComissao,
    valorComissaoFixa:  num(p.valorComissaoFixa),
    comissaoPercentual: num(p.comissaoPercentual),
    observacoes:        p.observacoes ?? '',
  }
}

export function ModalParceiro({
  parceiro, onClose, onSalvo,
}: {
  parceiro: Parceiro | null     // null = criando
  onClose:  () => void
  onSalvo:  () => void
}) {
  const [form, setForm]         = useState(paraFormulario(parceiro))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState('')

  const set = (k: keyof typeof vazio, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const fixo = form.tipoComissao === 'FIXO_MENSAL'

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      const body = {
        codigo:       form.codigo.trim().toUpperCase(),
        nomeParceiro: form.nomeParceiro.trim(),
        tipoComissao: form.tipoComissao,
        ...(form.documento.trim()      ? { documento:      form.documento.trim() }      : {}),
        ...(form.email.trim()          ? { email:          form.email.trim() }          : {}),
        ...(form.contatoCelular.trim() ? { contatoCelular: form.contatoCelular.trim() } : {}),
        ...(form.cidadeBase.trim()     ? { cidadeBase:     form.cidadeBase.trim() }     : {}),
        ...(form.observacoes.trim()    ? { observacoes:    form.observacoes.trim() }    : {}),
        ...(fixo
          ? { valorComissaoFixa:  Number(form.valorComissaoFixa)  || 0 }
          : { comissaoPercentual: Number(form.comissaoPercentual) || 0 }),
      }

      const res = await fetch(parceiro ? `/api/parceiro/${parceiro.id}` : '/api/parceiro', {
        method:  parceiro ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.erro ?? 'Não foi possível salvar o parceiro.')

      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSalvando(false)
    }
  }

  const parametroInvalido = fixo
    ? !(Number(form.valorComissaoFixa) > 0)
    : !(Number(form.comissaoPercentual) > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="font-bold text-white">{parceiro ? `Editar ${parceiro.nomeParceiro}` : 'Novo Parceiro'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className={rotulo}>Código *</label>
              <input className={`${campo} font-mono uppercase`} value={form.codigo} placeholder="OTIK22"
                maxLength={20} onChange={e => set('codigo', e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <label className={rotulo}>Nome do parceiro *</label>
              <input className={campo} value={form.nomeParceiro} placeholder="Nome ou razão social"
                onChange={e => set('nomeParceiro', e.target.value)} />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 -mt-2">
            O código é <strong className="text-slate-400">público</strong>: é o que o parceiro divulga e o cliente informa.
            Letras, números e hífen. Curto e fácil de ditar por telefone.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={rotulo}>Documento (CPF/CNPJ)</label>
              <input className={campo} value={form.documento} onChange={e => set('documento', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className={rotulo}>E-mail</label>
              <input className={campo} value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className={rotulo}>Celular</label>
              <input className={campo} value={form.contatoCelular} onChange={e => set('contatoCelular', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className={rotulo}>Cidade base</label>
              <input className={campo} value={form.cidadeBase} onChange={e => set('cidadeBase', e.target.value)} />
            </div>
          </div>

          {/* Regra de comissão */}
          <div className="space-y-3 border-t border-slate-800 pt-5">
            <p className={rotulo}>Regra de comissão</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Tipo</label>
                <select className={campo} value={form.tipoComissao} onChange={e => set('tipoComissao', e.target.value)}>
                  <option value="FIXO_MENSAL">Valor fixo por mês</option>
                  <option value="PERCENTUAL">Percentual do valor pago</option>
                </select>
              </div>

              {fixo ? (
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Valor por mês (R$) *</label>
                  <input className={campo} type="number" step="0.01" min={0} value={form.valorComissaoFixa}
                    onChange={e => set('valorComissaoFixa', e.target.value)} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Percentual (%) *</label>
                  <input className={campo} type="number" step="0.01" min={0} max={100} value={form.comissaoPercentual}
                    onChange={e => set('comissaoPercentual', e.target.value)} />
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              {fixo
                ? 'O valor é por mês coberto pelo pagamento: um pagamento trimestral gera três vezes esse valor, numa única linha.'
                : 'O percentual incide sobre o valor efetivamente pago, qualquer que seja o período.'}
              {' '}Alterar esta regra <strong className="text-slate-400">não</strong> reescreve comissões já apuradas — cada
              uma guarda a regra que valia no dia.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className={rotulo}>Observações internas</label>
            <textarea className={`${campo} h-20 resize-y`} value={form.observacoes}
              placeholder="Anotações sobre o acordo, contato, condições..."
              onChange={e => set('observacoes', e.target.value)} />
          </div>

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
            disabled={salvando || form.codigo.trim().length < 3 || form.nomeParceiro.trim().length < 2 || parametroInvalido}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors"
          >
            {salvando ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : parceiro ? 'Salvar alterações' : 'Criar parceiro'}
          </button>
        </div>
      </div>
    </div>
  )
}
