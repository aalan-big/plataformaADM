'use client'

import { useEffect, useState } from 'react'
import {
  X, Cpu, Key, RefreshCw, Copy, CheckCheck,
  Loader2, AlertCircle, Calendar, Clock,
  ShieldCheck, ShieldOff, ShieldAlert,
} from 'lucide-react'
import ModalGerarChave from './ModalGerarChave'

type HistoricoItem = {
  id: string
  chaveAtivacao: string
  dataVencimento: string
  meses: number
  ultimoPagamento: string | null
  criadoEm: string
}

type LicencaDetalhe = {
  id: string
  isTrial: boolean
  status: 'AGUARDANDO' | 'ATIVA' | 'BLOQUEADA' | 'VENCIDA'
  hwid: string | null
  nomeDispositivo: string | null
  chaveAtivacao: string | null
  dataVencimento: string | null
  criadoEm: string
  plano: { id: string; nome: string; precoMensal: number } | null
  cliente: {
    id: string
    email: string
    tipo: 'PF' | 'PJ'
    pf: { nomeCompleto: string } | null
    pj: { razaoSocial: string } | null
  }
  historico: HistoricoItem[]
}

function nomeCliente(l: LicencaDetalhe) {
  return l.cliente.tipo === 'PF'
    ? (l.cliente.pf?.nomeCompleto ?? l.cliente.email)
    : (l.cliente.pj?.razaoSocial ?? l.cliente.email)
}

function formatarData(iso: string) {
  const d = new Date(iso)
  const m = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${d.getDate().toString().padStart(2,'0')} ${m[d.getMonth()]} ${d.getFullYear()}`
}

function diasRestantes(dataVencimento: string | null): number | null {
  if (!dataVencimento) return null
  const diff = new Date(dataVencimento).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

const STATUS_CONFIG = {
  ATIVA:      { label: 'Ativa',      cor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', Icone: ShieldCheck  },
  AGUARDANDO: { label: 'Aguardando', cor: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',   Icone: ShieldAlert  },
  BLOQUEADA:  { label: 'Bloqueada',  cor: 'text-red-400 bg-red-500/10 border-red-500/20',             Icone: ShieldOff    },
  VENCIDA:    { label: 'Vencida',    cor: 'text-slate-400 bg-slate-700/30 border-slate-600/30',       Icone: ShieldOff    },
}

function CampoInfo({ label, valor, mono = false }: { label: string; valor?: string | null; mono?: boolean }) {
  if (!valor) return null
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm text-slate-200 break-all ${mono ? 'font-mono' : ''}`}>{valor}</p>
    </div>
  )
}

interface Props {
  licencaId: string
  onClose: () => void
  onAtualizar: () => void
}

export default function ModalDetalhe({ licencaId, onClose, onAtualizar }: Props) {
  const [licenca, setLicenca] = useState<LicencaDetalhe | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [modalRenovar, setModalRenovar] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro('')
    fetch(`/api/licenca/${licencaId}`)
      .then(r => r.json())
      .then(j => {
        if (j.data) setLicenca(j.data)
        else setErro('Licença não encontrada.')
      })
      .catch(() => setErro('Falha ao carregar dados.'))
      .finally(() => setCarregando(false))
  }

  useEffect(() => { carregar() }, [licencaId])

  async function copiarChave() {
    if (!licenca?.chaveAtivacao) return
    await navigator.clipboard.writeText(licenca.chaveAtivacao)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  const dias = licenca ? diasRestantes(licenca.dataVencimento) : null
  const statusCfg = licenca ? STATUS_CONFIG[licenca.status] : null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

        <div className="relative z-10 w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

          {/* Cabeçalho */}
          {licenca && !carregando ? (
            <div className="relative overflow-hidden rounded-t-2xl">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-blue-950/50" />
              <div
                className="absolute inset-0 opacity-[0.03]"
                style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '18px 18px' }}
              />
              <div className="relative px-6 py-5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-600/30 flex items-center justify-center shrink-0">
                    <Cpu size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <h2 className="text-lg font-bold text-white">
                        {licenca.nomeDispositivo ?? 'Dispositivo sem nome'}
                      </h2>
                      {licenca.isTrial && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                          TRIAL
                        </span>
                      )}
                      {statusCfg && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${statusCfg.cor}`}>
                          <statusCfg.Icone size={9} />
                          {statusCfg.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">{nomeCliente(licenca)} · {licenca.cliente.email}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Criada em {formatarData(licenca.criadoEm)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setModalRenovar(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-400 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-600/30 rounded-lg transition-colors"
                  >
                    <RefreshCw size={11} />
                    Renovar
                  </button>
                  <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/60 transition-colors">
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-end px-4 pt-4">
              <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800">
                <X size={16} />
              </button>
            </div>
          )}

          {/* Corpo */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {carregando && (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2 size={24} className="animate-spin text-blue-400" />
                <p className="text-slate-500 text-sm">Carregando licença...</p>
              </div>
            )}

            {erro && (
              <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm">
                <AlertCircle size={16} />
                {erro}
              </div>
            )}

            {licenca && !carregando && (
              <>
                {/* Vencimento em destaque */}
                {licenca.dataVencimento && (
                  <div className={`rounded-xl p-4 border ${
                    dias === null       ? 'bg-slate-800/40 border-slate-700/50' :
                    dias <= 0           ? 'bg-red-500/10 border-red-500/20' :
                    dias <= 7           ? 'bg-yellow-500/10 border-yellow-500/20' :
                                          'bg-emerald-500/10 border-emerald-500/20'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className={
                          dias === null ? 'text-slate-400' :
                          dias <= 0    ? 'text-red-400' :
                          dias <= 7    ? 'text-yellow-400' :
                                         'text-emerald-400'
                        } />
                        <span className="text-xs font-semibold text-slate-300">Vencimento</span>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${
                          dias === null ? 'text-slate-300' :
                          dias <= 0    ? 'text-red-400' :
                          dias <= 7    ? 'text-yellow-400' :
                                         'text-emerald-400'
                        }`}>
                          {formatarData(licenca.dataVencimento)}
                        </p>
                        {dias !== null && (
                          <p className="text-[11px] text-slate-500">
                            {dias <= 0 ? 'Vencida' : `${dias} dia${dias !== 1 ? 's' : ''} restante${dias !== 1 ? 's' : ''}`}
                          </p>
                        )}
                      </div>
                    </div>

                    {dias !== null && dias > 0 && (
                      <div className="mt-3">
                        <div className="w-full bg-slate-700/60 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              dias <= 7 ? 'bg-yellow-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, (dias / 365) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Chave de ativação */}
                {licenca.chaveAtivacao && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold flex items-center gap-1.5">
                      <Key size={10} />
                      Chave de Ativação
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-2.5 font-mono text-sm text-emerald-400 tracking-wider overflow-hidden">
                        {licenca.chaveAtivacao}
                      </div>
                      <button
                        onClick={copiarChave}
                        className="p-2.5 bg-slate-800 border border-slate-700 hover:border-emerald-600/50 hover:bg-emerald-600/10 rounded-lg text-slate-400 hover:text-emerald-400 transition-colors"
                        title="Copiar chave"
                      >
                        {copiado ? <CheckCheck size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Informações */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <CampoInfo label="Plano"           valor={licenca.plano?.nome} />
                  <CampoInfo label="Preço/mês"       valor={licenca.plano ? `R$ ${Number(licenca.plano.precoMensal).toFixed(2)}` : undefined} />
                  <CampoInfo label="Dispositivo"     valor={licenca.nomeDispositivo} />
                  <CampoInfo label="HWID"            valor={licenca.hwid} mono />
                </div>

                {/* Histórico de renovações */}
                {licenca.historico.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <span className="flex-1 h-px bg-slate-800" />
                      <Clock size={10} />
                      Histórico ({licenca.historico.length})
                      <span className="flex-1 h-px bg-slate-800" />
                    </p>
                    <div className="space-y-2">
                      {licenca.historico.map((h, i) => (
                        <div key={h.id} className="flex items-start gap-3">
                          <div className="flex flex-col items-center shrink-0 mt-0.5">
                            <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                            {i < licenca.historico.length - 1 && <div className="w-px h-8 bg-slate-700/60 mt-1" />}
                          </div>
                          <div className="flex-1 bg-slate-800/30 border border-slate-700/40 rounded-lg px-3 py-2.5">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[11px] text-slate-500">
                                {formatarData(h.criadoEm)}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-400">
                                +{h.meses} {h.meses === 1 ? 'mês' : 'meses'}
                              </span>
                            </div>
                            <p className="font-mono text-xs text-emerald-400/80">{h.chaveAtivacao}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Vencimento: {formatarData(h.dataVencimento)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {licenca.historico.length === 0 && (
                  <div className="text-center py-4">
                    <p className="text-xs text-slate-600">Nenhuma renovação registrada ainda.</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Rodapé */}
          {licenca && !carregando && (
            <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between">
              <p className="text-[11px] text-slate-600 font-mono truncate">ID: {licenca.id}</p>
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>

      {modalRenovar && licenca && (
        <ModalGerarChave
          licenca={licenca}
          onClose={() => setModalRenovar(false)}
          onSuccess={() => { carregar(); onAtualizar() }}
        />
      )}
    </>
  )
}
