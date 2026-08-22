'use client'

/**
 * Bancada da renovação pelo ERP local — PIX e cartão.
 *
 * Reproduz o que o ERP faz: pergunta os planos, gera a cobrança, desenha o QR e
 * fica em polling até o pagamento cair. A credencial é `chave` + `hwid`, igual
 * ao contrato — nada de licencaId, porque o ERP com licença vencida não tem esse
 * dado (o /validar não devolve quando está vencida).
 */

import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'

interface ApiResponse { ok: boolean; status: number; data: unknown }

async function post(url: string, body: unknown): Promise<ApiResponse> {
  const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

async function get(url: string): Promise<ApiResponse> {
  const res  = await fetch(url)
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0f172a] p-5 space-y-3">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{titulo}</p>
      {children}
    </div>
  )
}

function inp(placeholder: string, value: string, onChange: (e: ChangeEvent<HTMLInputElement>) => void) {
  return (
    <input type="text" value={value} onChange={onChange} placeholder={placeholder}
      className="w-full bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
  )
}

function sel(value: string, onChange: (v: string) => void, opcoes: Array<[string, string]>) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500/50">
      {opcoes.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  )
}

const btn = 'w-full py-2 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

/** Estado compartilhado por todas as seções: a credencial do ERP. */
function useCredencial() {
  const [chave, setChave] = useState('')
  const [hwid,  setHwid]  = useState('PC-DA-LOJA-01')
  return { chave, setChave, hwid, setHwid }
}

export function TemaRenovacao() {
  const cred = useCredencial()
  const [cobrancaId, setCobrancaId] = useState('')
  const [copiaECola, setCopiaECola] = useState('')
  const [qrBase64, setQrBase64]     = useState('')

  return (
    <>
      <SecaoCredencial cred={cred} />
      <SecaoPlanos cred={cred} />
      <SecaoCobranca
        cred={cred}
        onCobranca={(id, cec, qr) => { setCobrancaId(id); setCopiaECola(cec); setQrBase64(qr) }}
      />
      <SecaoQrCode copiaECola={copiaECola} qrBase64={qrBase64} />
      <SecaoStatus cred={cred} cobrancaId={cobrancaId} setCobrancaId={setCobrancaId} />
      <SecaoValidar cred={cred} />
    </>
  )
}

type Cred = ReturnType<typeof useCredencial>

function SecaoCredencial({ cred }: { cred: Cred }) {
  return (
    <Secao titulo="Credencial do ERP (chave + hwid)">
      {inp('chave de ativação (ex: TRIAL-XXXXXXXX)', cred.chave, e => cred.setChave(e.target.value))}
      {inp('hwid da máquina', cred.hwid, e => cred.setHwid(e.target.value))}
      <p className="text-[10px] text-slate-500 leading-relaxed">
        É a mesma credencial das outras rotas do ERP. Vale com a licença <strong className="text-slate-400">VENCIDA</strong> —
        quem precisa pagar é justamente quem venceu. Só bloqueio administrativo
        (bloqueada / suspensa / revogada) recusa.
      </p>
    </Secao>
  )
}

function SecaoPlanos({ cred }: { cred: Cred }) {
  const [res, setRes] = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="POST /licenca/renovacao/planos">
      <button
        disabled={!cred.chave}
        onClick={async () => setRes(await post('/api/erp/renovacao/planos', { chave: cred.chave, hwid: cred.hwid }))}
        className={`${btn} bg-indigo-700 hover:bg-indigo-600`}>
        Consultar períodos e preços
      </button>
      <p className="text-[10px] text-slate-500">
        O preço vem do plano <em>desta</em> licença — não existe tabela global. Cada
        período diz quais métodos aceita; PIX só aparece com o Asaas configurado.
      </p>
      <Console response={res} />
    </Secao>
  )
}

function SecaoCobranca({ cred, onCobranca }: {
  cred: Cred
  onCobranca: (id: string, copiaECola: string, qrBase64: string) => void
}) {
  const [metodo, setMetodo]   = useState('PIX')
  const [periodo, setPeriodo] = useState('MENSAL')
  const [res, setRes]         = useState<ApiResponse | null>(null)
  const [carregando, setCarregando] = useState(false)

  return (
    <Secao titulo="POST /licenca/renovacao/cobranca">
      {sel(metodo, setMetodo, [['PIX', 'PIX (Asaas)'], ['CARTAO', 'Cartão (Stripe)']])}
      {sel(periodo, setPeriodo, [['MENSAL', 'Mensal'], ['TRIMESTRAL', 'Trimestral'], ['ANUAL', 'Anual']])}
      <button
        disabled={!cred.chave || carregando}
        onClick={async () => {
          setCarregando(true)
          const r = await post('/api/erp/renovacao/cobranca', { chave: cred.chave, hwid: cred.hwid, metodo, periodo })
          setRes(r)
          const d = r.data as Record<string, string> | null
          if (r.ok && d?.cobrancaId) onCobranca(d.cobrancaId, d.pixCopiaECola ?? '', d.qrCodeBase64 ?? '')
          setCarregando(false)
        }}
        className={`${btn} bg-orange-700 hover:bg-orange-600`}>
        {carregando ? 'Gerando…' : 'Gerar cobrança'}
      </button>
      <p className="text-[10px] text-slate-500">
        Clicar duas vezes devolve a <strong className="text-slate-400">mesma</strong> cobrança —
        a trava de idempotência evita abrir dois PIX para a mesma licença e período.
      </p>
      <Console response={res} />
    </Secao>
  )
}

function SecaoQrCode({ copiaECola, qrBase64 }: { copiaECola: string; qrBase64: string }) {
  const [copiado, setCopiado] = useState(false)

  return (
    <Secao titulo="QR Code do PIX">
      {!copiaECola && !qrBase64 && (
        <p className="text-[11px] text-slate-600">Gere uma cobrança PIX para o QR aparecer aqui.</p>
      )}

      {qrBase64 && (
        <div className="flex justify-center bg-white rounded-xl p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${qrBase64}`} alt="QR Code PIX" className="w-44 h-44" />
        </div>
      )}

      {copiaECola && (
        <>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Copia e cola</p>
          <pre className="bg-black rounded-xl p-3 text-[10px] text-emerald-400 overflow-auto whitespace-pre-wrap break-all max-h-28">
            {copiaECola}
          </pre>
          <button
            onClick={() => { navigator.clipboard.writeText(copiaECola); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }}
            className={`${btn} bg-slate-700 hover:bg-slate-600`}>
            {copiado ? 'Copiado ✓' : 'Copiar código'}
          </button>
        </>
      )}
    </Secao>
  )
}

function SecaoStatus({ cred, cobrancaId, setCobrancaId }: {
  cred: Cred
  cobrancaId: string
  setCobrancaId: (v: string) => void
}) {
  const [res, setRes]         = useState<ApiResponse | null>(null)
  const [pollando, setPollando] = useState(false)
  const [contador, setContador] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const consultar = async () => {
    if (!cobrancaId || !cred.chave) return null
    const qs = new URLSearchParams({ chave: cred.chave, hwid: cred.hwid }).toString()
    const r  = await get(`/api/erp/renovacao/cobranca/${cobrancaId}?${qs}`)
    setRes(r)
    return r
  }

  // Polling a cada 5s, o mesmo intervalo que o contrato define para o ERP.
  // Para sozinho quando a cobrança sai de PENDENTE — não faz sentido continuar
  // batendo depois que o desfecho já aconteceu.
  useEffect(() => {
    if (!pollando) {
      if (timer.current) { clearInterval(timer.current); timer.current = null }
      return
    }
    timer.current = setInterval(async () => {
      setContador(c => c + 1)
      const r = await consultar()
      const status = (r?.data as { status?: string } | undefined)?.status
      if (status && status !== 'PENDENTE') setPollando(false)
    }, 5000)
    return () => { if (timer.current) clearInterval(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollando, cobrancaId, cred.chave, cred.hwid])

  return (
    <Secao titulo="GET /licenca/renovacao/cobranca/:id">
      {inp('cobrancaId (preenchido ao gerar)', cobrancaId, e => setCobrancaId(e.target.value))}

      <div className="grid grid-cols-2 gap-2">
        <button disabled={!cobrancaId || !cred.chave} onClick={consultar}
          className={`${btn} bg-cyan-800 hover:bg-cyan-700`}>
          Consultar uma vez
        </button>
        <button disabled={!cobrancaId || !cred.chave}
          onClick={() => { setContador(0); setPollando(p => !p) }}
          className={`${btn} ${pollando ? 'bg-red-800 hover:bg-red-700' : 'bg-emerald-800 hover:bg-emerald-700'}`}>
          {pollando ? `Parar (${contador})` : 'Polling 5s'}
        </button>
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Com o polling ligado, confirme o recebimento no painel do Asaas e observe aqui.
        Sem webhook, quem detecta é a reconciliação: a cada 30s a consulta pergunta ao
        gateway se já foi pago, e o mesmo processamento do webhook renova a licença.
      </p>
      <Console response={res} />
    </Secao>
  )
}

function SecaoValidar({ cred }: { cred: Cred }) {
  const [res, setRes] = useState<ApiResponse | null>(null)

  return (
    <Secao titulo="POST /erp/validar — a fonte da verdade">
      <button
        disabled={!cred.chave}
        onClick={async () => setRes(await post('/api/erp/validar', { chave: cred.chave, hwid: cred.hwid }))}
        className={`${btn} bg-fuchsia-800 hover:bg-fuchsia-700`}>
        Revalidar licença
      </button>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Depois de pagar, é aqui que o ERP descobre a nova <code className="text-slate-400">dataVencimento</code>.
        Repare em <code className="text-slate-400">emCarencia</code> e <code className="text-slate-400">diasRestantesCarencia</code>:
        preenchidos só quando o <strong className="text-slate-400">cartão</strong> falhou. Quem paga por PIX trava no vencimento.
      </p>
      <Console response={res} />
    </Secao>
  )
}
