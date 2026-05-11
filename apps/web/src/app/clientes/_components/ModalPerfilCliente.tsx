function LicencaCard({ licenca: l, onAtualizar }: { licenca: Licenca; onAtualizar: () => void }) {
  const [copiado,          setCopiado]          = useState(false)
  const [mostrarLink,      setMostrarLink]       = useState(false)
  const [gerando,          setGerando]           = useState<number | null>(null)
  const [urlGerada,        setUrlGerada]         = useState<string | null>(null)
  const [copiadoUrl,       setCopiadoUrl]        = useState(false)
  const [erroCob,          setErroCob]           = useState('')
  const [mostrarRenovar,   setMostrarRenovar]    = useState(false)
  const [renovando,        setRenovando]         = useState<number | null>(null)
  const [erroRenovar,      setErroRenovar]       = useState('')
  const [bloqueando,       setBloqueando]        = useState(false)
  const [erroBloq,         setErroBloq]          = useState('')
  const [mostrarHistorico, setMostrarHistorico]  = useState(false)
  const [confirmarExcluir, setConfirmarExcluir]  = useState(false)
  const [excluindo,        setExcluindo]         = useState(false)
  const [erroExcluir,      setErroExcluir]       = useState('')

  const cfg           = STATUS_CONFIG[l.status]
  const limiteEfetivo = (l.plano.limiteUsuario ?? 0) + l.usuariosExtras

  function fecharPaineis() {
    setMostrarLink(false); setUrlGerada(null); setErroCob('')
    setMostrarRenovar(false); setErroRenovar('')
  }

  function copiarChave() {
    navigator.clipboard.writeText(l.chaveAtivacao)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1500)
  }

  function copiarUrl() {
    if (!urlGerada) return
    navigator.clipboard.writeText(urlGerada)
    setCopiadoUrl(true)
    setTimeout(() => setCopiadoUrl(false), 1500)
  }

  async function toggleBloquear() {
    setBloqueando(true)
    setErroBloq('')
    const endpoint = l.status === 'BLOQUEADA' ? 'reativar' : 'bloquear'
    try {
      const res  = await fetch(`/api/licenca/${l.id}/${endpoint}`, { method: 'PATCH' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErroBloq(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      onAtualizar()
    } catch {
      setErroBloq('Falha na conexão.')
    } finally {
      setBloqueando(false)
    }
  }

  async function excluirLicenca() {
    setExcluindo(true)
    setErroExcluir('')
    try {
      const res  = await fetch(`/api/licenca/${l.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErroExcluir(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      onAtualizar()
    } catch {
      setErroExcluir('Falha na conexão.')
    } finally {
      setExcluindo(false)
      setConfirmarExcluir(false)
    }
  }

  async function gerarLink(meses: number) {
    setGerando(meses)
    setUrlGerada(null)
    setErroCob('')
    try {
      const res  = await fetch('/api/financeiro/gerar-cobranca', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ licencaId: l.id, meses }),
      })
      const json = await res.json()
      if (!res.ok) setErroCob(json.erro ?? json.message ?? 'Erro ao gerar link.')
      else setUrlGerada(json.url)
    } catch {
      setErroCob('Falha na conexão.')
    } finally {
      setGerando(null)
    }
  }

  async function renovarManual(meses: number) {
    setRenovando(meses)
    setErroRenovar('')
    try {
      const res  = await fetch(`/api/licenca/${l.id}/renovar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ meses }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErroRenovar(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      setMostrarRenovar(false)
      onAtualizar()
    } catch {
      setErroRenovar('Falha na conexão.')
    } finally {
      setRenovando(null)
    }
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-3">

      {/* ── Cabeçalho ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor size={14} className="text-slate-400 shrink-0" />
          <span className="text-sm font-medium text-slate-200 truncate">
            {l.nomeDispositivo ?? 'Sem nome'}
          </span>
          {l.isTrial && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 shrink-0">
              TRIAL
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${cfg.cls}`}>
            {cfg.label}
          </span>
          <button
            onClick={toggleBloquear}
            disabled={bloqueando}
            title={l.status === 'BLOQUEADA' ? 'Reativar licença' : 'Bloquear licença'}
            className={`p-1 rounded transition-colors disabled:opacity-40 ${
              l.status === 'BLOQUEADA'
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-slate-500 hover:text-orange-400 hover:bg-orange-500/10'
            }`}
          >
            {bloqueando
              ? <Loader2 size={12} className="animate-spin" />
              : l.status === 'BLOQUEADA' ? <Unlock size={12} /> : <Lock size={12} />
            }
          </button>
          <button
            onClick={() => { setConfirmarExcluir(v => !v); setErroExcluir('') }}
            title="Excluir licença"
            className="p-1 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {erroBloq && <p className="text-xs text-orange-400">{erroBloq}</p>}

      {/* ── Info grid ── */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">Plano</p>
          <p className="text-slate-300">{l.plano.nome}</p>
        </div>
        {l.dataVencimento && (
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide">Vencimento</p>
            <p className="text-slate-300">{formatData(l.dataVencimento)}</p>
          </div>
        )}
        <div>
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">Usuários</p>
          <p className={l.totalUsuarios >= limiteEfetivo && limiteEfetivo > 0 ? 'text-orange-400' : 'text-slate-300'}>
            {l.totalUsuarios}/{limiteEfetivo}
          </p>
        </div>
        <div>
          <p className="text-slate-500 text-[10px] uppercase tracking-wide">Última conexão</p>
          <p className="text-slate-300">{tempoRelativo(l.ultimoHeartbeat)}</p>
        </div>
      </div>

      {/* ── Chave de ativação ── */}
      <div className="flex items-center gap-2 bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-700/40">
        <KeyRound size={11} className="text-slate-500 shrink-0" />
        <span className="font-mono text-xs text-slate-400 flex-1 truncate">{l.chaveAtivacao}</span>
        <button
          onClick={copiarChave}
          title="Copiar chave"
          className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
        >
          {copiado ? <span className="text-[10px] text-emerald-400">Copiado!</span> : <Copy size={12} />}
        </button>
      </div>

      {/* ── Botões de ação ── */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => { fecharPaineis(); setMostrarLink(v => !v) }}
          className={`flex items-center justify-center gap-1.5 text-xs py-1.5 border border-dashed rounded-lg transition-colors ${
            mostrarLink
              ? 'text-blue-400 border-blue-500/40 bg-blue-500/5'
              : 'text-slate-400 hover:text-blue-400 border-slate-700 hover:border-blue-500/40'
          }`}
        >
          <CreditCard size={12} />
          {mostrarLink ? 'Fechar' : 'Gerar link'}
        </button>
        <button
          onClick={() => { fecharPaineis(); setMostrarRenovar(v => !v) }}
          className={`flex items-center justify-center gap-1.5 text-xs py-1.5 border border-dashed rounded-lg transition-colors ${
            mostrarRenovar
              ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/5'
              : 'text-slate-400 hover:text-emerald-400 border-slate-700 hover:border-emerald-500/40'
          }`}
        >
          <RefreshCw size={12} />
          {mostrarRenovar ? 'Fechar' : 'Renovar (admin)'}
        </button>
      </div>

      {/* ── Painel: link de pagamento Stripe ── */}
      {mostrarLink && (
        <div className="space-y-2.5">
          {urlGerada ? (
            <>
              <p className="text-[11px] text-slate-500 text-center">Link gerado — copie e envie ao cliente</p>
              <div className="flex items-center gap-2 bg-slate-900/70 rounded-lg px-3 py-2.5 border border-blue-500/25">
                <ExternalLink size={11} className="text-blue-400 shrink-0" />
                <span className="text-xs text-blue-300 flex-1 truncate">{urlGerada}</span>
                <button onClick={copiarUrl} className="text-slate-400 hover:text-slate-200 shrink-0 transition-colors">
                  {copiadoUrl ? <span className="text-[10px] text-emerald-400">Copiado!</span> : <Copy size={12} />}
                </button>
              </div>
              <button onClick={() => setUrlGerada(null)} className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                Gerar outro período
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 text-center">Selecione o período de renovação</p>
              <div className="grid grid-cols-3 gap-2">
                {PERIODOS.map(({ meses, label, sub }) => (
                  <button
                    key={meses}
                    disabled={gerando !== null}
                    onClick={() => gerarLink(meses)}
                    className="flex flex-col items-center gap-0.5 py-2.5 bg-slate-900/60 hover:bg-blue-600/10 border border-slate-700 hover:border-blue-500/40 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {gerando === meses
                      ? <Loader2 size={13} className="animate-spin text-blue-400" />
                      : <span className="text-xs font-semibold text-slate-200">{label}</span>
                    }
                    <span className="text-[10px] text-slate-500">{sub}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {erroCob && <p className="text-xs text-red-400 text-center">{erroCob}</p>}
        </div>
      )}

      {/* ── Painel: renovação manual (admin, sem cobrança) ── */}
      {mostrarRenovar && (
        <div className="space-y-2.5">
          <p className="text-[11px] text-slate-500 text-center">Renovar sem cobrança — estende o vencimento</p>
          <div className="grid grid-cols-3 gap-2">
            {PERIODOS.map(({ meses, label, sub }) => (
              <button
                key={meses}
                disabled={renovando !== null}
                onClick={() => renovarManual(meses)}
                className="flex flex-col items-center gap-0.5 py-2.5 bg-slate-900/60 hover:bg-emerald-600/10 border border-slate-700 hover:border-emerald-500/40 rounded-lg transition-colors disabled:opacity-50"
              >
                {renovando === meses
                  ? <Loader2 size={13} className="animate-spin text-emerald-400" />
                  : <span className="text-xs font-semibold text-slate-200">{label}</span>
                }
                <span className="text-[10px] text-slate-500">{sub}</span>
              </button>
            ))}
          </div>
          {erroRenovar && <p className="text-xs text-red-400 text-center">{erroRenovar}</p>}
        </div>
      )}

      {/* ── Histórico ── */}
      {l.historico.length > 0 && (
        <button
          onClick={() => setMostrarHistorico(v => !v)}
          className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
        >
          <History size={11} />
          {mostrarHistorico ? 'Ocultar histórico' : `Ver histórico (${l.historico.length})`}
        </button>
      )}

      {mostrarHistorico && (
        <div className="space-y-1.5">
          {l.historico.map(h => {
            const hcfg = HISTORICO_CONFIG[h.tipo] ?? { label: h.tipo, cls: 'text-slate-400 bg-slate-500/10' }
            return (
              <div key={h.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg bg-slate-900/40 border border-slate-700/30">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${hcfg.cls}`}>{hcfg.label}</span>
                <div className="flex-1 min-w-0">
                  {h.observacao    && <p className="text-[11px] text-slate-400 truncate">{h.observacao}</p>}
                  {h.dataVencimento && <p className="text-[10px] text-slate-500">até {formatData(h.dataVencimento)}</p>}
                </div>
                <span className="text-[10px] text-slate-600 shrink-0">{formatData(h.criadoEm)}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Confirmação de exclusão ── */}
      {confirmarExcluir && (
        <div className="bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertTriangle size={12} />
            <span>Tem certeza? Essa ação não pode ser desfeita.</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setConfirmarExcluir(false); setErroExcluir('') }}
              disabled={excluindo}
              className="flex-1 py-1.5 text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={excluirLicenca}
              disabled={excluindo}
              className="flex-1 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              {excluindo ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              {excluindo ? 'Excluindo...' : 'Confirmar'}
            </button>
          </div>
          {erroExcluir && <p className="text-xs text-red-400">{erroExcluir}</p>}
        </div>
      )}
    </div>
  )
}