'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search, RefreshCw, HardDriveDownload, Copy, CheckCheck,
  ShieldCheck, Clock, CircleAlert, MinusCircle, X, Image as ImageIcon, Database,
} from 'lucide-react'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Situacao = 'EM_DIA' | 'ATRASADO' | 'NUNCA' | 'NAO_ELEGIVEL'

type Copia = {
  tamanhoBytes: number
  geradoEm:     string
  hwid:         string | null
  chave:        string
}

type Item = {
  licencaId:        string
  clienteId:        string
  nomeCliente:      string
  email:            string
  plano:            string | null
  statusLicenca:    string
  isTrial:          boolean
  nomeDispositivo:  string | null
  elegivel:         boolean
  situacao:         Situacao
  horasDesdeUltimo: number | null
  falhas7Dias:      number
  prefixo:          string
  banco:            Copia | null
  imagens:          Copia | null
}

type Resumo = {
  elegiveis: number
  emDia:     number
  atrasados: number
  nunca:     number
  bytesTotal: number
  horasAteAtrasado: number
}

type Evento = {
  id:           string
  tipo:         string
  status:       string
  origem:       string
  tamanhoBytes: number
  hwid:         string | null
  emitidoEm:    string
  confirmadoEm: string | null
  erro:         string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tamanho(bytes: number | null | undefined) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function quando(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function haQuanto(horas: number | null) {
  if (horas === null) return '—'
  if (horas < 1)  return 'menos de 1h'
  if (horas < 48) return `há ${horas}h`
  return `há ${Math.floor(horas / 24)} dias`
}

const SITUACAO_CFG: Record<Situacao, { label: string; cor: string; Icone: React.ElementType }> = {
  EM_DIA:       { label: 'Em dia',       cor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', Icone: ShieldCheck  },
  ATRASADO:     { label: 'Atrasado',     cor: 'text-orange-400 bg-orange-500/10 border-orange-500/20',    Icone: Clock        },
  NUNCA:        { label: 'Nunca fez',    cor: 'text-red-400 bg-red-500/10 border-red-500/20',             Icone: CircleAlert  },
  NAO_ELEGIVEL: { label: 'Sem direito',  cor: 'text-slate-500 bg-slate-700/30 border-slate-600/30',       Icone: MinusCircle  },
}

function BadgeSituacao({ situacao }: { situacao: Situacao }) {
  const cfg = SITUACAO_CFG[situacao]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${cfg.cor}`}>
      <cfg.Icone size={9} />
      {cfg.label}
    </span>
  )
}

function BotaoCopiar({ texto, titulo }: { texto: string; titulo: string }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar(e: React.MouseEvent) {
    e.stopPropagation()
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1800)
  }
  return (
    <button onClick={copiar} className="p-1 text-slate-500 hover:text-emerald-400 transition-colors" title={titulo}>
      {copiado ? <CheckCheck size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  )
}

// ─── Gaveta de detalhe ────────────────────────────────────────────────────────

function GavetaEventos({ item, onFechar }: { item: Item; onFechar: () => void }) {
  const [eventos, setEventos] = useState<Evento[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    fetch(`/api/backups/${item.licencaId}/eventos`)
      .then(r => r.json())
      .then(j => { if (vivo) setEventos(j.eventos ?? []) })
      .catch(() => { if (vivo) setEventos([]) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [item.licencaId])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onFechar} />

      <div className="relative w-full max-w-lg bg-slate-900 border-l border-slate-800 overflow-y-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-white font-bold truncate">{item.nomeCliente}</p>
            <p className="text-slate-500 text-xs truncate">{item.email}</p>
          </div>
          <button onClick={onFechar} className="text-slate-500 hover:text-white shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Cópias atuais */}
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">
              Cópias na nuvem — no máximo 1 de cada
            </p>
            <div className="space-y-2">
              {([['banco', item.banco, Database], ['imagens', item.imagens, ImageIcon]] as const).map(
                ([nome, copia, Icone]) => (
                  <div key={nome} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                    <Icone size={15} className="text-slate-500 shrink-0" />
                    <span className="text-xs font-mono text-slate-400 w-20 shrink-0">{nome}.zip</span>
                    {copia
                      ? <span className="text-xs text-emerald-400 font-mono">
                          {tamanho(copia.tamanhoBytes)} · {quando(copia.geradoEm)}
                        </span>
                      : <span className="text-xs text-slate-600">nenhuma</span>}
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Prefixo */}
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">
              Pasta no bucket
            </p>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
              <code className="text-[11px] text-slate-300 break-all flex-1">{item.prefixo}</code>
              <BotaoCopiar texto={item.prefixo} titulo="Copiar para buscar no R2" />
            </div>
            <p className="text-[10px] text-slate-600 mt-1.5">
              Cole na busca do painel da Cloudflare para achar os arquivos deste cliente.
            </p>
          </div>

          {/* Histórico */}
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">
              Histórico de envios
            </p>
            <p className="text-[10px] text-slate-600 mb-2">
              Registro do que aconteceu — não são arquivos que dá para restaurar. Só existe a cópia atual.
            </p>

            {carregando
              ? <p className="text-xs text-slate-600 py-4 text-center">Carregando…</p>
              : eventos.length === 0
                ? <p className="text-xs text-slate-600 py-4 text-center">Nenhum envio registrado.</p>
                : (
                  <div className="space-y-1">
                    {eventos.map(e => (
                      <div key={e.id} className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono text-slate-400">
                            {quando(e.emitidoEm)} · {e.tipo.toLowerCase()} · {e.origem.toLowerCase()}
                          </span>
                          <span className={`text-[10px] font-bold ${
                            e.status === 'CONFIRMADO' ? 'text-emerald-400'
                            : e.status === 'FALHOU'   ? 'text-red-400'
                            : 'text-yellow-400'
                          }`}>
                            {e.status} · {tamanho(e.tamanhoBytes)}
                          </span>
                        </div>
                        {e.erro && <p className="text-[10px] text-red-400/80 mt-1">{e.erro}</p>}
                        {e.hwid && <p className="text-[10px] text-slate-600 mt-0.5 font-mono truncate">{e.hwid}</p>}
                      </div>
                    ))}
                  </div>
                )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function BackupsPage() {
  const [itens, setItens]           = useState<Item[]>([])
  const [resumo, setResumo]         = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca]           = useState('')
  const [filtro, setFiltro]         = useState<'' | Situacao>('')
  const [detalhe, setDetalhe]       = useState<Item | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const res  = await fetch('/api/backups')
      const json = await res.json()
      setItens(json.itens ?? [])
      setResumo(json.resumo ?? null)
    } catch {
      setItens([]); setResumo(null)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const q = busca.trim().toLowerCase()
  const visiveis = itens.filter(i =>
    (!filtro || i.situacao === filtro) &&
    (!q || i.nomeCliente.toLowerCase().includes(q) || i.email.toLowerCase().includes(q)),
  )

  const STATS = [
    { label: 'Com direito', valor: resumo?.elegiveis ?? 0, cor: 'text-white',       f: ''            as const },
    { label: 'Em dia',      valor: resumo?.emDia     ?? 0, cor: 'text-emerald-400', f: 'EM_DIA'      as const },
    { label: 'Atrasados',   valor: resumo?.atrasados ?? 0, cor: 'text-orange-400',  f: 'ATRASADO'    as const },
    { label: 'Nunca fez',   valor: resumo?.nunca     ?? 0, cor: 'text-red-400',     f: 'NUNCA'       as const },
  ]

  return (
    <div className="space-y-5">

      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-blue-950 border border-slate-800 p-8">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="relative flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <HardDriveDownload size={22} className="text-blue-400" />
              <h1 className="text-2xl font-black text-white tracking-tight">Backups</h1>
            </div>
            <p className="text-slate-400 text-sm max-w-xl">
              Quem tem direito a backup e está enviando — e, principalmente, quem não está.
              {resumo && (
                <> Considera atrasado depois de <strong className="text-slate-300">{resumo.horasAteAtrasado}h</strong> sem envio.</>
              )}
            </p>
          </div>

          <div className="text-right">
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Guardado na nuvem</p>
            <p className="text-2xl font-black text-white">{tamanho(resumo?.bytesTotal)}</p>
          </div>
        </div>
      </div>

      {/* STATS — clicáveis como filtro */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STATS.map(s => (
          <button
            key={s.label}
            onClick={() => setFiltro(f => (f === s.f ? '' : s.f))}
            className={`text-left rounded-xl border p-4 transition-all ${
              filtro === s.f && s.f
                ? 'bg-slate-800 border-blue-500/40'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'
            }`}
          >
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{s.label}</p>
            <p className={`text-2xl font-black ${s.cor}`}>{s.valor}</p>
          </button>
        ))}
      </div>

      {/* BUSCA */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por cliente ou e-mail…"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500/50"
          />
        </div>
        {filtro && (
          <button
            onClick={() => setFiltro('')}
            className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded-xl px-3 py-2.5"
          >
            Limpar filtro
          </button>
        )}
        <button
          onClick={carregar}
          disabled={carregando}
          className="flex items-center gap-2 text-sm text-slate-300 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl px-4 py-2.5 disabled:opacity-50"
        >
          <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* LISTA */}
      <div className="rounded-2xl border border-slate-800 overflow-hidden">
        {carregando ? (
          <p className="text-center text-slate-500 text-sm py-16">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-16">Nenhuma licença encontrada.</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {visiveis.map(i => (
              <button
                key={i.licencaId}
                onClick={() => setDetalhe(i)}
                className="w-full text-left px-5 py-4 bg-slate-900 hover:bg-slate-800/60 transition-colors flex items-center gap-4 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">{i.nomeCliente}</span>
                    <BadgeSituacao situacao={i.situacao} />
                    {i.falhas7Dias > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-red-400 bg-red-500/10 border-red-500/20">
                        {i.falhas7Dias} falha(s) em 7 dias
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {i.email}
                    {i.plano && <> · {i.plano}</>}
                    {i.nomeDispositivo && <> · {i.nomeDispositivo}</>}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-300 font-mono">
                    {i.banco ? tamanho(i.banco.tamanhoBytes) : '—'}
                    {i.imagens && <span className="text-slate-500"> + {tamanho(i.imagens.tamanhoBytes)}</span>}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {i.situacao === 'NUNCA' ? 'nunca enviou' : haQuanto(i.horasDesdeUltimo)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {detalhe && <GavetaEventos item={detalhe} onFechar={() => setDetalhe(null)} />}
    </div>
  )
}
