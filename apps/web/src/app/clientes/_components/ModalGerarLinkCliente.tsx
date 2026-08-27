'use client'

import { useState, useEffect } from 'react'
import { X, CreditCard, Loader2, Copy, ExternalLink, Monitor, AlertCircle, QrCode } from 'lucide-react'

type Metodo = 'PIX' | 'CARTAO'

function reais(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

type Licenca = {
  id:              string
  nomeDispositivo: string | null
  status:          string
  isTrial:         boolean
  plano:           { nome: string }
  dataVencimento:  string | null
}

const PERIODOS = [
  { meses: 1,  label: '1 mês',      sub: 'Mensal'     },
  { meses: 3,  label: '3 meses',    sub: 'Trimestral'  },
  { meses: 12, label: '12 meses',   sub: 'Anual'       },
]

const STATUS_CLS: Record<string, string> = {
  ATIVA:      'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  BLOQUEADA:  'text-orange-400  bg-orange-500/10  border-orange-500/20',
  SUSPENSA:   'text-yellow-400  bg-yellow-500/10  border-yellow-500/20',
  VENCIDA:    'text-red-400     bg-red-500/10     border-red-500/20',
  AGUARDANDO: 'text-slate-400   bg-slate-500/10   border-slate-500/20',
}

function formatData(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR')
}

type Props = {
  clienteId:   string
  nomeCliente: string
  onClose:     () => void
}

export default function ModalGerarLinkCliente({ clienteId, nomeCliente, onClose }: Props) {
  const [licencas,       setLicencas]       = useState<Licenca[]>([])
  const [carregando,     setCarregando]      = useState(true)
  const [erro,           setErro]            = useState('')
  const [licencaSel,     setLicencaSel]      = useState<Licenca | null>(null)
  const [gerando,        setGerando]         = useState<number | null>(null)
  const [urlGerada,      setUrlGerada]       = useState<string | null>(null)
  const [erroGerar,      setErroGerar]       = useState('')
  const [copiado,        setCopiado]         = useState(false)

  const [metodo,     setMetodo]     = useState<Metodo>('PIX')
  const [pixCodigo,  setPixCodigo]  = useState('')
  const [pixQr,      setPixQr]      = useState('')
  /** Composição do valor, quando a cobrança inclui módulo avulso. */
  const [composicao, setComposicao] = useState<{ plano: number; modulos: number; total: number } | null>(null)

  function limparResultado() {
    setUrlGerada(null); setPixCodigo(''); setPixQr(''); setComposicao(null); setErroGerar('')
  }

  useEffect(() => {
    async function carregar() {
      try {
        const res  = await fetch(`/api/licenca/cliente/${clienteId}`)
        const json = await res.json()
        const lista: Licenca[] = json.data ?? json ?? []
        setLicencas(lista)
        if (lista.length === 1) setLicencaSel(lista[0])
      } catch {
        setErro('Falha ao carregar licenças.')
      } finally {
        setCarregando(false)
      }
    }
    carregar()
  }, [clienteId])

  async function gerarLink(meses: number) {
    if (!licencaSel) return
    setGerando(meses)
    limparResultado()
    try {
      const rota = metodo === 'PIX'
        ? '/api/financeiro/gerar-cobranca-pix'
        : '/api/financeiro/gerar-cobranca'

      const res  = await fetch(rota, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ licencaId: licencaSel.id, meses }),
      })
      const json = await res.json()
      if (!res.ok) { setErroGerar(json.erro ?? json.message ?? 'Erro ao gerar cobrança.'); return }

      if (metodo === 'PIX') {
        /**
         * Código ausente não é erro: o gateway pode ter demorado além do teto
         * de espera. A cobrança existe — o que não pode é o operador copiar um
         * campo vazio e mandar ao cliente achando que mandou um PIX.
         */
        if (!json.pixCopiaECola) {
          setErroGerar('A cobrança foi criada, mas o código ainda não veio do gateway. Gere de novo em alguns segundos.')
          return
        }
        setPixCodigo(json.pixCopiaECola)
        setPixQr(json.qrCodeBase64 ?? '')

        // Só mostra a composição quando há módulo somado — no caso normal a
        // linha extra só polui.
        if (json.valorModulosCentavos > 0) {
          setComposicao({
            plano:   json.valorPlanoCentavos,
            modulos: json.valorModulosCentavos,
            total:   json.valorCentavos,
          })
        }
      } else {
        setUrlGerada(json.url)
      }
    } catch {
      setErroGerar('Falha na conexão.')
    } finally {
      setGerando(null)
    }
  }

  function copiar() {
    const texto = metodo === 'PIX' ? pixCodigo : urlGerada
    if (!texto) return
    navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/20 flex items-center justify-center">
              <CreditCard size={15} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Gerar cobrança</h2>
              <p className="text-[11px] text-slate-400 truncate max-w-56">{nomeCliente}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Loading */}
          {carregando && (
            <div className="flex flex-col items-center gap-2 py-8">
              <Loader2 size={22} className="animate-spin text-blue-400" />
              <p className="text-xs text-slate-500">Carregando licenças...</p>
            </div>
          )}

          {/* Erro ao carregar */}
          {!carregando && erro && (
            <div className="flex items-center gap-2 text-red-400 text-sm py-4 justify-center">
              <AlertCircle size={15} />
              <span>{erro}</span>
            </div>
          )}

          {/* Sem licenças */}
          {!carregando && !erro && licencas.length === 0 && (
            <div className="text-center py-8">
              <Monitor size={28} className="mx-auto text-slate-700 mb-2" />
              <p className="text-sm text-slate-500">Este cliente não possui licenças cadastradas.</p>
            </div>
          )}

          {/* Seleção de licença (quando há mais de uma) */}
          {!carregando && licencas.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Selecione a licença
              </p>
              <div className="space-y-2">
                {licencas.map(l => {
                  const cls    = STATUS_CLS[l.status] ?? STATUS_CLS.AGUARDANDO
                  const ativa  = licencaSel?.id === l.id
                  return (
                    <button
                      key={l.id}
                      onClick={() => { setLicencaSel(l); setUrlGerada(null); setErroGerar('') }}
                      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition-all ${
                        ativa
                          ? 'border-blue-500/50 bg-blue-600/8'
                          : 'border-slate-700/60 bg-slate-800/30 hover:border-slate-600'
                      }`}
                    >
                      <Monitor size={14} className="text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate">
                          {l.nomeDispositivo ?? 'Sem nome'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {l.plano.nome} · vence {formatData(l.dataVencimento)}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${cls}`}>
                        {l.status}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Licença única — exibe info resumida */}
          {!carregando && licencas.length === 1 && licencaSel && (
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-slate-700/60 bg-slate-800/30">
              <Monitor size={14} className="text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">
                  {licencaSel.nomeDispositivo ?? 'Sem nome'}
                </p>
                <p className="text-[11px] text-slate-500">
                  {licencaSel.plano.nome} · vence {formatData(licencaSel.dataVencimento)}
                </p>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${STATUS_CLS[licencaSel.status] ?? STATUS_CLS.AGUARDANDO}`}>
                {licencaSel.status}
              </span>
            </div>
          )}

          {/* Método de pagamento */}
          {licencaSel && !urlGerada && !pixCodigo && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Forma de pagamento
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { valor: 'PIX'    as const, Icone: QrCode,     titulo: 'PIX',    sub: 'código na hora' },
                  { valor: 'CARTAO' as const, Icone: CreditCard, titulo: 'Cartão', sub: 'link, renova sozinho' },
                ]).map(({ valor, Icone, titulo, sub }) => (
                  <button
                    key={valor}
                    onClick={() => { setMetodo(valor); limparResultado() }}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all text-left ${
                      metodo === valor
                        ? 'border-blue-500/50 bg-blue-600/8'
                        : 'border-slate-700/60 bg-slate-800/30 hover:border-slate-600'
                    }`}
                  >
                    <Icone size={15} className={metodo === valor ? 'text-blue-400' : 'text-slate-500'} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200">{titulo}</p>
                      <p className="text-[10px] text-slate-500">{sub}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Seleção de período + link gerado */}
          {licencaSel && !urlGerada && !pixCodigo && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Período de renovação
              </p>
              <div className="grid grid-cols-3 gap-2">
                {PERIODOS.map(({ meses, label, sub }) => (
                  <button
                    key={meses}
                    disabled={gerando !== null}
                    onClick={() => gerarLink(meses)}
                    className="flex flex-col items-center gap-0.5 py-3 bg-slate-800/50 hover:bg-blue-600/10 border border-slate-700 hover:border-blue-500/40 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {gerando === meses
                      ? <Loader2 size={14} className="animate-spin text-blue-400" />
                      : <span className="text-sm font-semibold text-slate-200">{label}</span>
                    }
                    <span className="text-[11px] text-slate-500">{sub}</span>
                  </button>
                ))}
              </div>
              {erroGerar && (
                <p className="text-xs text-red-400 flex items-center gap-1.5 pt-1">
                  <AlertCircle size={12} /> {erroGerar}
                </p>
              )}
            </div>
          )}

          {/* Link gerado */}
          {urlGerada && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 text-center">
                Link gerado — copie e envie ao cliente
              </p>
              <div className="flex items-center gap-2 bg-slate-800/60 rounded-xl px-3.5 py-3 border border-blue-500/25">
                <ExternalLink size={12} className="text-blue-400 shrink-0" />
                <span className="text-xs text-blue-300 flex-1 min-w-0 break-all">{urlGerada}</span>
              </div>
              <button
                onClick={copiar}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {copiado ? <span className="text-emerald-300">Copiado!</span> : <><Copy size={14} /> Copiar link</>}
              </button>
              <button
                onClick={limparResultado}
                className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors py-1"
              >
                Gerar para outro período
              </button>
            </div>
          )}

          {/* PIX gerado */}
          {pixCodigo && (
            <div className="space-y-3">
              {composicao && (
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl px-3.5 py-2.5 space-y-1">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Composição do valor</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Plano</span>
                    <span className="text-slate-300">{reais(composicao.plano)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Módulos avulsos</span>
                    <span className="text-slate-300">{reais(composicao.modulos)}</span>
                  </div>
                  <div className="flex justify-between text-xs pt-1 border-t border-slate-700/60">
                    <span className="text-slate-300 font-medium">Total</span>
                    <span className="text-white font-semibold">{reais(composicao.total)}</span>
                  </div>
                </div>
              )}

              {pixQr && (
                <img
                  src={`data:image/png;base64,${pixQr}`}
                  alt="QR Code do PIX"
                  className="w-40 h-40 mx-auto rounded-lg bg-white p-1.5"
                />
              )}

              <p className="text-xs text-slate-500 text-center">
                Copia e cola — envie ao cliente
              </p>
              <div className="bg-slate-800/60 rounded-xl px-3.5 py-3 border border-emerald-500/25">
                <span className="text-[11px] text-emerald-300 break-all font-mono">{pixCodigo}</span>
              </div>
              <button
                onClick={copiar}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {copiado ? <span>Copiado!</span> : <><Copy size={14} /> Copiar código PIX</>}
              </button>
              <button
                onClick={limparResultado}
                className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors py-1"
              >
                Gerar outra cobrança
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
