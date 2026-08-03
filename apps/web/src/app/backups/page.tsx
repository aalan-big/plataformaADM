'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search, RefreshCw, Eye, X, Copy, CheckCheck, Download,
  HardDriveDownload, ShieldCheck, Clock, CircleAlert, MinusCircle,
  Database, Image as ImageIcon,
} from 'lucide-react'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Situacao = 'EM_DIA' | 'ATRASADO' | 'NUNCA' | 'NAO_ELEGIVEL'

type Copia = {
  tamanhoBytes: number
  geradoEm:     string
  hwid:         string | null
  chave:        string
}

/// A corrente do ciclo não é uma cópia, é uma CADEIA: o full mais os fragmentos,
/// e nenhum elo sozinho representa o conjunto. Vem agregada — quantos elos e
/// quanto ocupam — mas com a lista junto, porque é a sequência que denuncia um
/// buraco, e buraco no meio invalida tudo que vem depois dele.
type Elo = {
  sequencia: number
  bytes:     number
  geradoEm:  string
}

type Corrente = {
  elos:            number
  bytes:           number
  ultimaSequencia: number
  lista:           Elo[]
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
  ciclo:            string | null
  full:             Copia | null
  corrente:         Corrente
}

type Resumo = {
  elegiveis:        number
  emDia:            number
  atrasados:        number
  nunca:            number
  bytesTotal:       number
  horasAteAtrasado: number
}

type Evento = {
  id:           string
  tipo:         string
  ciclo:        string
  sequencia:    number
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
  EM_DIA:       { label: 'Em dia',      cor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', Icone: ShieldCheck },
  ATRASADO:     { label: 'Atrasado',    cor: 'text-orange-400 bg-orange-500/10 border-orange-500/20',    Icone: Clock       },
  NUNCA:        { label: 'Nunca fez',   cor: 'text-red-400 bg-red-500/10 border-red-500/20',             Icone: CircleAlert },
  NAO_ELEGIVEL: { label: 'Sem direito', cor: 'text-slate-400 bg-slate-700/30 border-slate-600/30',       Icone: MinusCircle },
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

// ─── Modal de detalhe ─────────────────────────────────────────────────────────

/**
 * Baixa o backup de um cliente. Pede confirmação porque o clique produz um link
 * para o banco de dados de uma empresa — cadastro, financeiro e a carteira de
 * clientes dela. Não é o tipo de coisa que deve sair de um clique errado.
 */
/// Baixa UM elo da corrente. Sem `sequencia` vem o full (a sequência 0), que é o
/// único elo que sozinho significa alguma coisa — um fragmento solto é diferença
/// sem base, e quem clicasse acharia que baixou o backup do cliente.
function BotaoBaixar({ licencaId, ciclo, sequencia, existe, compacto }: {
  licencaId:  string
  ciclo?:     string | null
  sequencia?: number
  existe:     boolean
  compacto?:  boolean
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [baixando, setBaixando]       = useState(false)
  const [erro, setErro]               = useState('')

  async function baixar() {
    if (!confirmando) {
      setConfirmando(true)
      setTimeout(() => setConfirmando(false), 4000)
      return
    }

    setConfirmando(false); setBaixando(true); setErro('')
    try {
      const res  = await fetch(`/api/backups/${licencaId}/url-download`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ciclo, sequencia }),
      })
      const json = await res.json()

      if (!res.ok) { setErro(json?.message ?? 'Falha ao gerar o link.'); return }

      // Navegação direta em vez de <a download>: a URL é de outro domínio (o
      // bucket), e o atributo download é ignorado entre origens. O nome do
      // arquivo quem define é o cabeçalho que o bucket devolve.
      window.open(json.url, '_blank', 'noopener')
    } catch {
      setErro('Falha de conexão ao gerar o link.')
    } finally {
      setBaixando(false)
    }
  }

  if (!existe) return null

  return (
    <div className={compacto ? '' : 'mt-3'}>
      <button
        onClick={baixar}
        disabled={baixando}
        className={`flex items-center justify-center gap-1.5 rounded-lg font-semibold border transition-all disabled:opacity-40 ${
          compacto ? 'px-2.5 py-1 text-[11px]' : 'w-full px-3 py-1.5 text-xs'
        } ${
          confirmando
            ? 'bg-amber-600/25 border-amber-500/50 text-amber-300 animate-pulse'
            : 'border-slate-700 text-slate-300 hover:border-blue-500/50 hover:text-blue-400'
        }`}
      >
        <Download size={11} />
        {baixando ? 'Gerando...' : confirmando ? 'Confirmar?' : 'Baixar'}
      </button>
      {erro && <p className="text-[10px] text-red-400 mt-1">{erro}</p>}
    </div>
  )
}

function ModalDetalhe({ item, onClose }: { item: Item; onClose: () => void }) {
  const [eventos, setEventos]       = useState<Evento[]>([])
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl bg-[#0f1117] border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-600/15 border border-blue-600/20 flex items-center justify-center shrink-0">
              <HardDriveDownload size={15} className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-slate-200 font-semibold text-sm truncate">{item.nomeCliente}</p>
              <p className="text-[11px] text-slate-500 truncate">{item.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-6">

          {/* O full — a base da corrente */}
          <div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold mb-2">
              Full do ciclo {item.ciclo ?? '—'} — a base sobre a qual tudo é aplicado
            </p>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database size={13} className="text-slate-500" />
                <span className="text-[11px] font-mono text-slate-400">full.zip</span>
                <span className="text-[10px] text-slate-600">sequência 0</span>
              </div>
              {item.full ? (
                <>
                  <p className="text-slate-200 text-lg font-bold leading-none">{tamanho(item.full.tamanhoBytes)}</p>
                  <p className="text-[11px] text-slate-500 mt-1.5">{quando(item.full.geradoEm)}</p>
                </>
              ) : (
                <p className="text-slate-600 text-sm">Nenhum — sem full, nada restaura</p>
              )}
              <BotaoBaixar licencaId={item.licencaId} existe={!!item.full} />
            </div>
          </div>

          {/* A corrente de fragmentos */}
          <div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold mb-2">
              Fragmentos — extraídos por cima do full, nesta ordem
            </p>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              {item.corrente.elos > 0 ? (
                <>
                  <div className="flex items-end justify-between gap-4 mb-3">
                    <div>
                      <p className="text-slate-200 text-lg font-bold leading-none">
                        {item.corrente.elos} {item.corrente.elos === 1 ? 'elo' : 'elos'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        {tamanho(item.corrente.bytes)} no total · até a sequência {item.corrente.ultimaSequencia}
                      </p>
                    </div>
                    <p className="text-[11px] text-slate-600 text-right max-w-[50%]">
                      Um elo faltando no meio invalida tudo que vem depois — confira se a sequência
                      não pula número.
                    </p>
                  </div>

                  <div className="border-t border-slate-800 pt-2 space-y-1 max-h-56 overflow-y-auto">
                    {item.corrente.lista.map((e, i, lista) => {
                      // Sequência que pula é buraco na corrente, e é o que mais
                      // importa ver aqui. Compara com o elo anterior (o full é o 0).
                      const esperado = i === 0 ? 1 : lista[i - 1].sequencia + 1
                      const buraco   = e.sequencia !== esperado

                      return (
                        <div key={e.sequencia} className="flex items-center justify-between gap-3 py-1">
                          <div className="min-w-0">
                            <p className={`text-[12px] font-mono truncate ${buraco ? 'text-red-400' : 'text-slate-300'}`}>
                              frag-{String(e.sequencia).padStart(3, '0')}.zip
                              {buraco && <span className="ml-2 text-[10px]">⚠ falta o elo {esperado}</span>}
                            </p>
                            <p className="text-[10px] text-slate-600">
                              {tamanho(e.bytes)} · {quando(e.geradoEm)}
                            </p>
                          </div>
                          <BotaoBaixar
                            licencaId={item.licencaId}
                            ciclo={item.ciclo}
                            sequencia={e.sequencia}
                            existe
                            compacto
                          />
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="text-slate-600 text-sm">
                  Nenhum fragmento — o full sozinho já restaura o estado daquele momento
                </p>
              )}
            </div>
          </div>

          {/* Pasta no bucket */}
          <div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold mb-2">
              Pasta no bucket
            </p>
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-2">
              <code className="text-[11px] text-slate-300 break-all flex-1">{item.prefixo}</code>
              <BotaoCopiar texto={item.prefixo} titulo="Copiar para buscar no R2" />
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Cole na busca do painel da Cloudflare para achar os arquivos deste cliente.
            </p>
          </div>

          {/* Histórico */}
          <div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold mb-1">
              Histórico de envios
            </p>
            <p className="text-[11px] text-slate-500 mb-3">
              Registro do que aconteceu — não são arquivos restauráveis. Só existe a cópia atual.
            </p>

            {carregando ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-slate-500 text-xs">Carregando histórico...</span>
              </div>
            ) : eventos.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10">
                <HardDriveDownload size={26} className="text-slate-700" />
                <p className="text-slate-500 text-sm">Nenhum envio registrado.</p>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800/70 overflow-hidden">
                {eventos.map(e => (
                  <div key={e.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-slate-400 font-mono">
                        {quando(e.emitidoEm)} · {e.tipo.toLowerCase()}
                        {e.ciclo && ` ${e.ciclo}#${e.sequencia}`} · {e.origem.toLowerCase()}
                      </span>
                      <span className={`text-[10px] font-bold shrink-0 ${
                        e.status === 'CONFIRMADO' ? 'text-emerald-400'
                        : e.status === 'FALHOU'   ? 'text-red-400'
                        : 'text-yellow-400'
                      }`}>
                        {e.status} · {tamanho(e.tamanhoBytes)}
                      </span>
                    </div>
                    {e.erro  && <p className="text-[10px] text-red-400/80 mt-1">{e.erro}</p>}
                    {e.hwid  && <p className="text-[10px] text-slate-600 mt-0.5 font-mono truncate">{e.hwid}</p>}
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
  const [filtro, setFiltro]         = useState<string>('')
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

  // A busca aceita nome, e-mail e também os UUIDs — é assim que se descobre de
  // quem é uma pasta vista no bucket: copia o id de lá e cola aqui. Aceita o
  // caminho inteiro colado, para não ter que separar os pedaços na mão.
  const q = busca.trim().toLowerCase()
  const visiveis = itens.filter(i => {
    if (filtro && i.situacao !== filtro) return false
    if (!q) return true

    return i.nomeCliente.toLowerCase().includes(q)
        || i.email.toLowerCase().includes(q)
        || i.clienteId.toLowerCase().includes(q)
        || i.licencaId.toLowerCase().includes(q)
        || q.includes(i.clienteId.toLowerCase())
        || q.includes(i.licencaId.toLowerCase())
  })

  const STATS = [
    { label: 'Com direito', valor: resumo?.elegiveis ?? 0, cor: 'text-white'       },
    { label: 'Em dia',      valor: resumo?.emDia     ?? 0, cor: 'text-emerald-400' },
    { label: 'Atrasados',   valor: resumo?.atrasados ?? 0, cor: 'text-orange-400'  },
    { label: 'Nunca fez',   valor: resumo?.nunca     ?? 0, cor: 'text-red-400'     },
  ]

  return (
    <div className="space-y-5">

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-blue-950 border border-slate-800 p-8">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-linear-to-l from-blue-950/60 to-transparent pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-[0.25em] mb-1.5">
              Cópias de Segurança
            </p>
            <h1 className="text-3xl font-extrabold text-white uppercase tracking-wide">
              Backups
            </h1>
            <p className="text-slate-400 text-[13px] mt-2 max-w-lg">
              Quem tem direito a backup e está enviando — e, principalmente, quem não está.
              {resumo && <> Atrasado após <strong className="text-slate-300">{resumo.horasAteAtrasado}h</strong> sem envio.</>}
            </p>
          </div>

          <div className="flex items-stretch gap-3 shrink-0 flex-wrap">
            {STATS.map(s => (
              <div key={s.label} className="bg-slate-800/70 backdrop-blur border border-slate-700/50 rounded-xl px-5 py-3 text-center min-w-18">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <HardDriveDownload size={10} className="text-slate-400" />
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">{s.label}</p>
                </div>
                <p className={`text-2xl font-extrabold ${s.cor}`}>
                  {carregando ? '—' : s.valor}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FILTROS ──────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-56 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Nome, e-mail, ou cole o UUID vindo do bucket..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-300 placeholder-slate-500 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
          />
        </div>

        <select
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          <option value="">Todas as situações</option>
          <option value="NUNCA">Nunca fez</option>
          <option value="ATRASADO">Atrasados</option>
          <option value="EM_DIA">Em dia</option>
          <option value="NAO_ELEGIVEL">Sem direito</option>
        </select>

        <div className="ml-auto flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Guardado na nuvem</p>
            <p className="text-sm font-bold text-slate-200 leading-none">{tamanho(resumo?.bytesTotal)}</p>
          </div>
          <button
            onClick={carregar}
            disabled={carregando}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors shadow-lg shadow-blue-900/30"
          >
            <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {/* ── TABELA ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Cliente / Dispositivo</th>
                <th className="text-left px-5 py-3 font-semibold">Plano</th>
                <th className="text-left px-5 py-3 font-semibold">Situação</th>
                <th className="text-left px-5 py-3 font-semibold">Último envio</th>
                <th className="text-left px-5 py-3 font-semibold">Tamanho</th>
                <th className="text-left px-5 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">

              {carregando && (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-slate-500 text-xs">Carregando backups...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!carregando && visiveis.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2">
                      <HardDriveDownload size={28} className="text-slate-700" />
                      <p className="text-slate-500 text-sm">
                        {busca || filtro
                          ? 'Nenhuma licença encontrada com esses filtros.'
                          : 'Nenhuma licença cadastrada ainda.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {!carregando && visiveis.map(i => (
                <tr
                  key={i.licencaId}
                  onClick={() => setDetalhe(i)}
                  className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                >
                  {/* Cliente / Dispositivo */}
                  <td className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-600/20 flex items-center justify-center shrink-0 mt-0.5">
                        <HardDriveDownload size={13} className="text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-200 leading-tight text-[13px] truncate">{i.nomeCliente}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">{i.email}</p>
                        {i.nomeDispositivo && (
                          <p className="text-[11px] text-slate-600 mt-0.5 truncate">{i.nomeDispositivo}</p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Plano */}
                  <td className="px-5 py-4">
                    <p className="text-slate-300 text-[13px]">{i.plano ?? '—'}</p>
                    {i.isTrial && <p className="text-[11px] text-yellow-400 font-bold">TRIAL</p>}
                  </td>

                  {/* Situação */}
                  <td className="px-5 py-4">
                    <div className="flex flex-col gap-1 items-start">
                      <BadgeSituacao situacao={i.situacao} />
                      {i.falhas7Dias > 0 && (
                        <span className="text-[10px] font-bold text-red-400">
                          {i.falhas7Dias} falha(s) em 7d
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Último envio */}
                  <td className="px-5 py-4">
                    <p className={`text-[13px] font-medium ${
                      i.situacao === 'NUNCA'    ? 'text-red-400'
                      : i.situacao === 'ATRASADO' ? 'text-orange-400'
                      : 'text-slate-300'
                    }`}>
                      {i.situacao === 'NUNCA' ? 'Nunca enviou' : haQuanto(i.horasDesdeUltimo)}
                    </p>
                    {i.ciclo && <p className="text-[11px] text-slate-500">ciclo {i.ciclo}</p>}
                  </td>

                  {/* Tamanho */}
                  <td className="px-5 py-4">
                    <p className="text-slate-300 text-[13px]">
                      {i.full ? tamanho(i.full.tamanhoBytes) : '—'}
                    </p>
                    {i.corrente.elos > 0 && (
                      <p className="text-[11px] text-slate-500">
                        + {tamanho(i.corrente.bytes)} em {i.corrente.elos} frag.
                      </p>
                    )}
                  </td>

                  {/* Ações */}
                  <td className="px-5 py-4">
                    <button
                      onClick={e => { e.stopPropagation(); setDetalhe(i) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 text-slate-300 hover:border-blue-500/50 hover:text-blue-400 transition-all"
                    >
                      <Eye size={11} />
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detalhe && <ModalDetalhe item={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
  )
}
