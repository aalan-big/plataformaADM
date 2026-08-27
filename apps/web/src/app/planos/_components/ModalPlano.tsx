'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import type { Plano, Modulo } from '../_tipos'

const campo = 'w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40'
const rotulo = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide'

const vazio = {
  nome: '', descricaoCheckout: '', limiteUsuario: '1',
  precoMensal: '', precoTrimestral: '', precoAnual: '',
  valorLicencaAdicional: '', descontoTrimestral: '', descontoAnual: '',
  publico: false,
}

/**
 * Módulos marcados, com a cota digitada por identificador.
 *
 * A cota é string e não número porque vazio precisa ser distinguível de zero:
 * vazio quer dizer "sem teto", zero quer dizer "não pode emitir nada".
 */
type SelecaoModulos = Record<string, { marcado: boolean; cota: string }>

function selecaoInicial(p: Plano | null): SelecaoModulos {
  const sel: SelecaoModulos = {}
  for (const pm of p?.modulos ?? []) {
    sel[pm.modulo.identificador] = {
      marcado: true,
      cota:    pm.cotaMensal == null ? '' : String(pm.cotaMensal),
    }
  }
  return sel
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
    publico:               !!p.publico,
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

  const [catalogo, setCatalogo] = useState<Modulo[]>([])
  const [selecao,  setSelecao]  = useState<SelecaoModulos>(() => selecaoInicial(plano))

  useEffect(() => {
    let cancelado = false
    fetch('/api/modulo')
      .then(r => r.json())
      .then(j => { if (!cancelado) setCatalogo(j.data ?? []) })
      .catch(() => { /* catálogo indisponível só esconde a seção; não trava o resto do form */ })
    return () => { cancelado = true }
  }, [])

  const set = (k: keyof typeof vazio, v: string | boolean) => setForm(prev => ({ ...prev, [k]: v }))

  function alternarModulo(identificador: string) {
    setSelecao(prev => {
      const atual = prev[identificador]
      return { ...prev, [identificador]: { marcado: !atual?.marcado, cota: atual?.cota ?? '' } }
    })
  }

  function definirCota(identificador: string, cota: string) {
    setSelecao(prev => ({ ...prev, [identificador]: { marcado: prev[identificador]?.marcado ?? true, cota } }))
  }

  function modulosSelecionados() {
    return catalogo
      .filter(m => selecao[m.identificador]?.marcado)
      .map(m => {
        const cota = selecao[m.identificador]?.cota ?? ''
        return {
          identificador: m.identificador,
          // Vazio = sem teto. Zero é valor legítimo e diferente disso.
          cotaMensal: cota.trim() === '' ? null : Math.max(0, parseInt(cota) || 0),
        }
      })
  }

  const numeroOuOmitir = (v: string) => (v.trim() === '' ? undefined : Number(v))

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      const body = {
        nome:          form.nome.trim(),
        limiteUsuario: parseInt(form.limiteUsuario) || 1,
        precoMensal:   Number(form.precoMensal) || 0,
        publico:       form.publico,
        /**
         * Só vai quando o catálogo carregou.
         *
         * Se a busca falhou, `catalogo` está vazio e mandar `[]` diria ao
         * servidor "este plano não tem módulo nenhum" — apagaria os vínculos por
         * causa de uma requisição que não respondeu. Omitir preserva.
         */
        ...(catalogo.length > 0 ? { modulos: modulosSelecionados() } : {}),
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

          {/* Módulos inclusos */}
          {catalogo.length > 0 && (
            <div className="space-y-1.5">
              <label className={rotulo}>Módulos inclusos no plano</label>
              <div className="space-y-1.5">
                {catalogo.map(m => {
                  const sel     = selecao[m.identificador]
                  const marcado = !!sel?.marcado
                  const cota    = sel?.cota ?? ''
                  return (
                    <div
                      key={m.id}
                      className={`rounded-lg border px-3 py-2.5 transition-colors ${
                        marcado ? 'bg-slate-800/60 border-slate-600' : 'bg-slate-900/40 border-slate-800'
                      }`}
                    >
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => alternarModulo(m.identificador)}
                          className="mt-0.5 accent-blue-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-200 font-medium">{m.nome}</p>
                          {m.descricao && <p className="text-[11px] text-slate-500">{m.descricao}</p>}
                          {!m.ativo && (
                            <p className="text-[10px] text-amber-400 mt-0.5">Módulo inativo no catálogo.</p>
                          )}
                        </div>
                      </label>

                      {marcado && (
                        <div className="mt-2 pl-6 flex items-center gap-2">
                          <input
                            type="number" min={0} value={cota}
                            onChange={e => definirCota(m.identificador, e.target.value)}
                            placeholder="Sem limite"
                            className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 placeholder-slate-500 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                          />
                          <span className="text-[11px] text-slate-500">
                            {cota.trim() === ''
                              ? 'uso mensal sem limite'
                              : `máximo por mês — ao atingir, o uso é bloqueado até a virada do mês`}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-500">
                Vale para licenças deste plano. O ERP do cliente passa a enxergar a mudança em até 24h,
                quando revalidar a licença. Emissões em homologação não consomem cota.
              </p>
            </div>
          )}

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

          {/* Visibilidade pública */}
          <label className="flex items-start gap-3 bg-slate-800/40 border border-slate-700/60 rounded-xl px-4 py-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.publico}
              onChange={e => set('publico', e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-blue-500 shrink-0"
            />
            <span className="text-sm">
              <span className="font-semibold text-slate-200">Exibir na página pública de contratação</span>
              <span className="block text-[11px] text-slate-500 mt-1 leading-relaxed">
                Marcado, o plano aparece em <strong className="text-slate-400">assine.startbig.com.br</strong> e qualquer
                pessoa pode contratá-lo pelo site. Deixe desmarcado para planos de canal, de parceiro ou de uso interno —
                eles continuam funcionando normalmente, só não viram vitrine.
              </span>
            </span>
          </label>

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
