'use client'

import { useState, useEffect, useCallback } from 'react'
import { Boxes, Loader2, AlertCircle, Pencil, X, Check, Layers, Ticket, ShieldCheck } from 'lucide-react'

type PlanoDoModulo = { nome: string; cotaMensal: number | null }

type Modulo = {
  id:              string
  identificador:   string
  nome:            string
  descricao:       string | null
  ativo:           boolean
  precoMensal:     string | number | null
  planos:          PlanoDoModulo[]
  licencasAvulsas: number
  incluidoPorPadrao: boolean
}

/**
 * Módulos cuja regra é aplicada pelo SERVIDOR.
 *
 * A distinção não é decoração: a emissão de NF-e passa pela API, então negar ali
 * é definitivo. Um módulo que só existe dentro do ERP depende do ERP esconder o
 * menu — e quem controla a máquina pode ignorar isso. Quem vai definir preço
 * precisa enxergar essa diferença na hora de decidir quanto cobrar.
 */
const APLICADO_NO_SERVIDOR = new Set(['NFE', 'NFCE', 'NFSE'])

function formatarReais(v: string | number | null) {
  if (v == null) return null
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function ModulosPage() {
  const [modulos, setModulos]       = useState<Modulo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState('')

  const carregar = useCallback(async () => {
    setErro('')
    try {
      const res  = await fetch('/api/modulo')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.erro ?? json.message ?? `Erro ${res.status}.`); return }
      setModulos(json.data ?? [])
    } catch {
      setErro('Falha ao carregar o catálogo de módulos.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-5">
      <div className="flex items-start gap-3">
        <Boxes size={20} className="text-slate-400 mt-0.5 shrink-0" />
        <div>
          <h1 className="text-lg font-semibold text-white">Módulos</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            O que o sistema sabe liberar e cobrar separadamente. Para incluir num plano, edite o plano em <span className="text-slate-400">Planos</span>;
            para liberar só para um cliente, use o card da licença no perfil dele.
          </p>
        </div>
      </div>

      {carregando && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Carregando…
        </p>
      )}

      {erro && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 flex items-center gap-2">
          <AlertCircle size={13} /> {erro}
        </div>
      )}

      <div className="space-y-2">
        {modulos.map(m => <CardModulo key={m.id} modulo={m} onSalvo={carregar} />)}
      </div>

      {!carregando && modulos.length === 0 && !erro && (
        <div className="text-center py-12">
          <Boxes size={26} className="mx-auto text-slate-700 mb-2" />
          <p className="text-sm text-slate-500">Catálogo vazio.</p>
          <p className="text-[11px] text-slate-600 mt-1">
            Rode <code className="text-slate-500">scripts/semear-modulos.ts</code> para criar os módulos iniciais.
          </p>
        </div>
      )}
    </div>
  )
}

function CardModulo({ modulo, onSalvo }: { modulo: Modulo; onSalvo: () => void }) {
  const [editando, setEditando] = useState(false)

  return (
    <div className={`rounded-xl border transition-colors ${
      modulo.ativo ? 'bg-slate-900/50 border-slate-700/50' : 'bg-slate-900/20 border-slate-800/60'
    }`}>
      {editando
        ? <FormaEdicao modulo={modulo} onFechar={() => setEditando(false)} onSalvo={onSalvo} />
        : <Leitura modulo={modulo} onEditar={() => setEditando(true)} />}
    </div>
  )
}

/** Estado padrão: mostra fatos, não formulário. */
function Leitura({ modulo, onEditar }: { modulo: Modulo; onEditar: () => void }) {
  const preco     = formatarReais(modulo.precoMensal)
  const noServidor = APLICADO_NO_SERVIDOR.has(modulo.identificador)

  return (
    <div className="p-3.5 flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-semibold ${modulo.ativo ? 'text-slate-100' : 'text-slate-500'}`}>
            {modulo.nome}
          </span>
          <code className="text-[10px] font-mono text-slate-500 bg-slate-800/70 px-1.5 py-0.5 rounded">
            {modulo.identificador}
          </code>
          {!modulo.ativo && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400">INATIVO</span>
          )}
          {/* O selo mais importante da lista: diz que este módulo chega a todo
              cliente sem depender de vínculo, e portanto que mexer nele tem
              alcance de base inteira. */}
          {modulo.incluidoPorPadrao && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300" title="Entra na licença de todos os clientes, inclusive em planos futuros">
              BASE
            </span>
          )}
          {noServidor && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex items-center gap-1"
              title="A regra é aplicada pela API — o ERP não tem como contornar."
            >
              <ShieldCheck size={10} /> trava no servidor
            </span>
          )}
        </div>

        {modulo.descricao && (
          <p className="text-[11px] text-slate-500">{modulo.descricao}</p>
        )}

        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px]">
          <span className="flex items-center gap-1.5">
            <Layers size={11} className="text-slate-600" />
            {modulo.planos.length === 0 ? (
              <span className="text-slate-600">em nenhum plano</span>
            ) : (
              <span className="text-slate-400">
                {modulo.planos.map(p => p.nome + (p.cotaMensal != null ? ` (${p.cotaMensal}/mês)` : '')).join(', ')}
              </span>
            )}
          </span>

          {modulo.licencasAvulsas > 0 && (
            <span className="flex items-center gap-1.5 text-slate-400">
              <Ticket size={11} className="text-slate-600" />
              {modulo.licencasAvulsas} licença{modulo.licencasAvulsas > 1 ? 's' : ''} à parte
            </span>
          )}

          <span className={preco ? 'text-slate-300' : 'text-slate-600'}>
            {preco ? `${preco}/mês avulso` : 'sem venda avulsa'}
          </span>
        </div>
      </div>

      <button
        onClick={onEditar}
        className="flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg text-[11px] font-semibold transition-colors shrink-0"
      >
        <Pencil size={11} /> Editar
      </button>
    </div>
  )
}

function FormaEdicao({ modulo, onFechar, onSalvo }: {
  modulo:   Modulo
  onFechar: () => void
  onSalvo:  () => void
}) {
  const [nome, setNome]           = useState(modulo.nome)
  const [descricao, setDescricao] = useState(modulo.descricao ?? '')
  // String, não número: vazio precisa ser distinguível de zero.
  const [preco, setPreco]         = useState(modulo.precoMensal == null ? '' : String(Number(modulo.precoMensal)))
  const [ativo, setAtivo]         = useState(modulo.ativo)
  const [salvando, setSalvando]   = useState(false)
  const [erro, setErro]           = useState('')

  const desativandoEmUso = !ativo && modulo.ativo && (modulo.planos.length > 0 || modulo.licencasAvulsas > 0)

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      const res = await fetch(`/api/modulo/${modulo.identificador}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          descricao: descricao.trim() || null,
          ativo,
          // Nulo explícito, não campo omitido: omitir significa "não mexe", e o
          // preço apagado na tela continuaria valendo no banco.
          precoMensal: preco.trim() === '' ? null : Math.max(0, Number(preco) || 0),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detalhes = Array.isArray(json?.detalhes) ? json.detalhes.map((d: any) => d.mensagem).join(' ') : null
        setErro(detalhes ?? json.erro ?? json.message ?? `Erro ${res.status}.`)
        return
      }
      onSalvo()
      onFechar()
    } catch {
      setErro('Falha ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const campo = 'w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40'

  return (
    <div className="p-3.5 space-y-3">
      <div className="flex items-center gap-2">
        <code className="text-[10px] font-mono text-slate-500 bg-slate-800/70 px-1.5 py-0.5 rounded shrink-0">
          {modulo.identificador}
        </code>
        <span className="text-[10px] text-slate-600">não pode ser alterado — o ERP compara por ele</span>
        <button onClick={onFechar} className="ml-auto text-slate-500 hover:text-slate-300 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Nome</label>
        <input value={nome} onChange={e => setNome(e.target.value)} className={campo} />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Descrição</label>
        <input
          value={descricao}
          onChange={e => setDescricao(e.target.value)}
          placeholder="Uma linha, exibida no painel"
          className={campo}
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Preço de venda avulsa</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">R$</span>
          <input
            type="number" min={0} step="0.01" value={preco}
            onChange={e => setPreco(e.target.value)}
            placeholder="vazio = não vende"
            className={`${campo} w-32`}
          />
          <span className="text-xs text-slate-500">/mês</span>
        </div>
        <p className="text-[10px] text-slate-600">
          {preco.trim() === ''
            ? 'Sem preço, o módulo só chega ao cliente por plano ou concessão manual.'
            : 'Valor de referência para a contratação avulsa. A concessão continua sendo feita por você no perfil do cliente.'}
        </p>
      </div>

      {/* Módulo-base não pode ser desativado por aqui: ele entra na claim de
          TODA licença, e desmarcar esta caixa apagaria o módulo da base inteira
          de uma vez. O servidor recusa de qualquer forma (400) — a caixa
          desabilitada existe para o operador não descobrir isso pelo erro. */}
      <label className={`flex items-center gap-2 text-xs w-fit ${
        modulo.incluidoPorPadrao ? 'text-slate-500 cursor-not-allowed' : 'text-slate-300 cursor-pointer'
      }`}>
        <input
          type="checkbox" checked={ativo}
          disabled={modulo.incluidoPorPadrao}
          onChange={e => setAtivo(e.target.checked)}
          className="accent-blue-500 disabled:opacity-40"
        />
        Ativo no catálogo
      </label>

      {modulo.incluidoPorPadrao && (
        <div className="text-[11px] text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 flex items-start gap-1.5">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>
            <strong>Módulo-base:</strong> entra na licença de todos os clientes, inclusive
            em planos criados no futuro. Não pode ser desativado por aqui — desligá-lo
            tiraria o acesso da base inteira. Para aposentá-lo, tire a marca de base no
            <code className="mx-1 px-1 rounded bg-slate-800 text-slate-300">semear-modulos.ts</code>
            primeiro.
          </span>
        </div>
      )}

      {desativandoEmUso && !modulo.incluidoPorPadrao && (
        <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex items-start gap-1.5">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>
            Este módulo está em uso
            {modulo.planos.length > 0 && ` em ${modulo.planos.length} plano(s)`}
            {modulo.licencasAvulsas > 0 && `${modulo.planos.length > 0 ? ' e' : ''} em ${modulo.licencasAvulsas} licença(s) à parte`}.
            {/* O prazo real: o ERP relê a claim a cada requisição e reescreve o
                token na revalidação online, que roda no boot e a cada poucos
                minutos de navegação. "Até 24h" dava a impressão de haver uma
                tarde para voltar atrás — não há. */}
            {' '}Loja aberta perde o acesso em minutos; quem está offline, ao reconectar.
          </span>
        </div>
      )}

      {erro && (
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle size={11} /> {erro}
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          onClick={onFechar}
          className="px-3 py-1.5 border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-lg text-xs font-semibold transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
        >
          {salvando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Salvar
        </button>
      </div>
    </div>
  )
}
