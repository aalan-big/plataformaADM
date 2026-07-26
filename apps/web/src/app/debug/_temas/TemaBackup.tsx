'use client'

import { useState } from 'react'
import { Console } from '../_shared/Console'

interface ApiResponse {
  ok: boolean; status?: number; statusText?: string; payload?: unknown; error?: string
}

async function api(url: string, token: string, options?: RequestInit): Promise<ApiResponse> {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      ...options,
    })
    const data = await res.json()
    return { status: res.status, statusText: res.statusText, ok: res.ok, payload: data }
  } catch (err) {
    return { error: 'Falha na conexão', ok: false, payload: err instanceof Error ? err.message : String(err) }
  }
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.startbig.com.br'
const ic  = 'w-full bg-[#0f172a] border border-slate-600 rounded p-2 outline-none transition text-sm'
const lc  = 'block text-xs uppercase font-bold text-slate-500 mb-1'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={lc}>{label}</label>{children}</div>
}

function RotaBadge({ metodo, rota }: { metodo: string; rota: string }) {
  const cor = metodo === 'POST' ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
            : 'bg-sky-950/60 text-sky-300 border-sky-800/50'
  return <span className={`text-xs font-mono border px-2 py-0.5 rounded ${cor}`}>{metodo} {rota}</span>
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// O hwid tem que ser o MESMO que está dentro do token, senão a API recusa com
/// BACKUP_HWID_DIVERGENTE. Quem define é o login do ERP (que gera um
/// `login-<uuid>` quando o cliente não manda hwid), então lê-se de lá.
function hwidDoToken(token: string): string {
  try {
    return JSON.parse(atob(token.split('.')[1])).hwid ?? ''
  } catch {
    return ''
  }
}

/// Bytes determinísticos do tamanho pedido — é o "zip" de brinquedo do teste.
function gerarConteudo(tamanhoBytes: number): Uint8Array {
  const semente = 'startbig-backup-laboratorio-'
  const bytes   = new Uint8Array(tamanhoBytes)
  for (let i = 0; i < tamanhoBytes; i++) bytes[i] = semente.charCodeAt(i % semente.length)
  return bytes
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function base64De(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// ── Linha de passo do ciclo ────────────────────────────────────────────────

type EstadoPasso = 'pendente' | 'rodando' | 'ok' | 'erro'

interface Passo {
  nome:     string
  estado:   EstadoPasso
  detalhe?: string
}

function LinhaPasso({ passo, n }: { passo: Passo; n: number }) {
  const icone = passo.estado === 'ok'      ? '✔'
              : passo.estado === 'erro'    ? '✘'
              : passo.estado === 'rodando' ? '…'
              : '·'
  const cor   = passo.estado === 'ok'      ? 'text-emerald-400 border-emerald-700/50 bg-emerald-950/20'
              : passo.estado === 'erro'    ? 'text-red-400 border-red-700/50 bg-red-950/20'
              : passo.estado === 'rodando' ? 'text-cyan-400 border-cyan-700/50 bg-cyan-950/20'
              : 'text-slate-600 border-slate-700/40'

  return (
    <div className={`flex items-start gap-3 border rounded p-2 ${cor}`}>
      <span className="font-black text-xs w-4 shrink-0 text-center">{icone}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold">{n}. {passo.nome}</p>
        {passo.detalhe && <p className="text-[11px] opacity-80 font-mono break-all mt-0.5">{passo.detalhe}</p>}
      </div>
    </div>
  )
}

// ── Ciclo completo ─────────────────────────────────────────────────────────

function SecaoCiclo({ token, onFim }: { token: string; onFim: () => void }) {
  const [hwid,     setHwid]     = useState('')
  const [tipo,     setTipo]     = useState<'banco' | 'imagens'>('banco')
  const [tamanho,  setTamanho]  = useState(65536)
  const [load,     setLoad]     = useState(false)
  const [passos,   setPassos]   = useState<Passo[]>([])
  const [res,      setRes]      = useState<ApiResponse | null>(null)

  const hwidEfetivo = hwid.trim() || hwidDoToken(token)

  const atualizar = (i: number, dados: Partial<Passo>) =>
    setPassos(ps => ps.map((p, idx) => idx === i ? { ...p, ...dados } : p))

  const rodar = async () => {
    setLoad(true); setRes(null)
    setPassos([
      { nome: 'Gerar arquivo e calcular SHA-256',        estado: 'rodando' },
      { nome: 'POST /erp/backup/url-upload',             estado: 'pendente' },
      { nome: 'PUT na URL assinada (via ponte /api)',    estado: 'pendente' },
      { nome: 'POST /erp/backup/confirmar',              estado: 'pendente' },
    ])

    // 1. Arquivo + checksum
    const bytes    = gerarConteudo(tamanho)
    const checksum = await sha256Hex(bytes)
    atualizar(0, { estado: 'ok', detalhe: `${mb(tamanho)} · sha256 ${checksum.slice(0, 16)}…` })

    // 2. Pedir a URL
    atualizar(1, { estado: 'rodando' })
    const pedido = await api(`${API}/erp/backup/url-upload`, token, {
      method: 'POST',
      body: JSON.stringify({
        hwid: hwidEfetivo, tipo, tamanhoBytes: tamanho,
        checksumSha256: checksum, origem: 'MANUAL',
      }),
    })
    setRes(pedido)

    if (!pedido.ok) {
      const p = pedido.payload as { codigo?: string; message?: string }
      atualizar(1, { estado: 'erro', detalhe: `${pedido.status} ${p?.codigo ?? ''} — ${p?.message ?? ''}` })
      setLoad(false); return
    }

    const dados = pedido.payload as {
      acao: string; uploadId?: string; url?: string; chave?: string; motivo?: string
    }

    // O servidor pode responder PULAR: imagens com checksum igual ao último não
    // sobem. É sucesso, não erro — e é o corte de custo funcionando.
    if (dados.acao === 'PULAR') {
      atualizar(1, { estado: 'ok', detalhe: `acao=PULAR — ${dados.motivo ?? 'nada mudou'}` })
      atualizar(2, { estado: 'ok', detalhe: 'nada a enviar (upload economizado)' })
      atualizar(3, { estado: 'ok', detalhe: 'nada a confirmar' })
      setLoad(false); onFim(); return
    }

    atualizar(1, { estado: 'ok', detalhe: `chave: ${dados.chave}` })

    // 3. PUT pela ponte server-side
    atualizar(2, { estado: 'rodando' })
    const ponte = await fetch('/api/debug/backup-upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url: dados.url, conteudoBase64: base64De(bytes), contentType: 'application/zip',
      }),
    })
    const resultadoPonte = await ponte.json() as {
      ok?: boolean; status?: number; respostaBucket?: string; erro?: string; etag?: string
    }

    if (!resultadoPonte.ok) {
      atualizar(2, {
        estado:  'erro',
        detalhe: `HTTP ${resultadoPonte.status ?? ponte.status} — ${resultadoPonte.erro ?? resultadoPonte.respostaBucket ?? 'sem detalhe'}`,
      })
      setRes({ ok: false, status: resultadoPonte.status ?? ponte.status, payload: resultadoPonte })
      setLoad(false); return
    }
    atualizar(2, { estado: 'ok', detalhe: `HTTP ${resultadoPonte.status} · etag ${resultadoPonte.etag ?? '—'}` })

    // 4. Confirmar (a API confere no bucket antes de acreditar)
    atualizar(3, { estado: 'rodando' })
    const confirma = await api(`${API}/erp/backup/confirmar`, token, {
      method: 'POST',
      body: JSON.stringify({
        uploadId: dados.uploadId, hwid: hwidEfetivo, ok: true, tamanhoBytes: tamanho,
      }),
    })
    setRes(confirma)

    if (confirma.ok) {
      atualizar(3, { estado: 'ok', detalhe: 'HeadObject conferiu tamanho — backup registrado' })
    } else {
      const p = confirma.payload as { codigo?: string; message?: string }
      atualizar(3, { estado: 'erro', detalhe: `${confirma.status} ${p?.codigo ?? ''} — ${p?.message ?? ''}` })
    }

    setLoad(false); onFim()
  }

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-emerald-800/50 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-emerald-400 uppercase tracking-wider">Ciclo Completo de Backup</h2>
        <RotaBadge metodo="POST" rota="/erp/backup/url-upload" />
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Faz o que o ERP vai fazer: gera o arquivo, pede a URL, sobe e confirma.
      </p>

      <div className="p-3 rounded border border-red-700/60 bg-red-950/30 mb-4">
        <p className="text-red-300 text-xs font-bold mb-1">⚠ Este teste ESCREVE no backup real da licença</p>
        <p className="text-red-400/80 text-[11px] leading-relaxed">
          Cada licença tem um único <code>banco.zip</code> e um único <code>imagens.zip</code>, e o
          upload sobrescreve o que estava lá. Rodar isto numa licença de cliente real substitui o
          backup dele por este arquivo de brinquedo. Use uma licença de teste.
        </p>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select className={`${ic} focus:border-emerald-500`} value={tipo}
              onChange={e => setTipo(e.target.value as 'banco' | 'imagens')}>
              <option value="banco">banco</option>
              <option value="imagens">imagens</option>
            </select>
          </Field>
          <Field label="Tamanho em bytes (mín. 1024)">
            <input type="number" className={`${ic} focus:border-emerald-500`}
              value={tamanho} onChange={e => setTamanho(Number(e.target.value))} />
          </Field>
        </div>

        <Field label="HWID (vazio = usa o do token)">
          <input className={`${ic} focus:border-emerald-500`}
            placeholder={hwidDoToken(token) || 'sem hwid no token'}
            value={hwid} onChange={e => setHwid(e.target.value)} />
        </Field>

        <button onClick={rodar} disabled={load || !token || tamanho < 1024}
          className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
          {load ? 'Rodando ciclo...' : 'Rodar ciclo completo'}
        </button>

        {passos.length > 0 && (
          <div className="space-y-1.5">
            {passos.map((p, i) => <LinhaPasso key={p.nome} passo={p} n={i + 1} />)}
          </div>
        )}

        {res && <Console response={res} />}
      </div>
    </section>
  )
}

// ── Status ─────────────────────────────────────────────────────────────────

function SecaoStatus({ token, versao }: { token: string; versao: number }) {
  const [load, setLoad] = useState(false)
  const [res,  setRes]  = useState<ApiResponse | null>(null)

  const buscar = async () => {
    setLoad(true); setRes(null)
    setRes(await api(`${API}/erp/backup/status`, token))
    setLoad(false)
  }

  const d = res?.ok ? (res.payload as {
    planoPermiteBackup: boolean
    motivoBloqueio:     string | null
    limiteDiario:       { banco: number; imagens: number }
    enviadosHoje:       { banco: number; imagens: number }
    copiaAtual:         Record<string, { tamanhoBytes: number; geradoEm: string } | null>
    historicoEventos:   Array<{ tipo: string; status: string; tamanhoBytes: number; emitidoEm: string; erro: string | null }>
  }) : null

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-sky-800/50 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-sky-400 uppercase tracking-wider">Status do Backup</h2>
        <RotaBadge metodo="GET" rota="/erp/backup/status" />
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Leitura pura. Mostra se o plano libera backup, a cota do dia e o que existe na nuvem.
      </p>

      <button onClick={buscar} disabled={load || !token}
        className="w-full bg-sky-700 hover:bg-sky-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition mb-3">
        {load ? 'Buscando...' : 'GET /erp/backup/status'}
      </button>

      {d && (
        <div className="space-y-3 mb-3">
          <div className={`p-3 rounded border text-sm ${d.planoPermiteBackup
            ? 'border-emerald-700/40 bg-emerald-950/20 text-emerald-300'
            : 'border-orange-700/40 bg-orange-950/20 text-orange-300'}`}>
            <p className="font-bold text-xs uppercase tracking-wide">
              {d.planoPermiteBackup ? 'Plano libera backup' : 'Backup bloqueado'}
            </p>
            {d.motivoBloqueio && <p className="text-[11px] mt-1 opacity-90">{d.motivoBloqueio}</p>}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded border border-slate-700/50 bg-[#0f172a]">
              <p className="text-slate-500 text-[10px] uppercase font-bold">Cota banco hoje</p>
              <p className="text-slate-200 font-mono">{d.enviadosHoje.banco} / {d.limiteDiario.banco}</p>
            </div>
            <div className="p-2 rounded border border-slate-700/50 bg-[#0f172a]">
              <p className="text-slate-500 text-[10px] uppercase font-bold">Cota imagens hoje</p>
              <p className="text-slate-200 font-mono">{d.enviadosHoje.imagens} / {d.limiteDiario.imagens}</p>
            </div>
          </div>

          <div>
            <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">
              Cópias na nuvem — no máximo 1 de cada
            </p>
            <div className="space-y-1">
              {(['banco', 'imagens'] as const).map(t => {
                const c = d.copiaAtual?.[t]
                return (
                  <div key={t} className="flex items-center justify-between text-xs p-2 rounded border border-slate-700/50 bg-[#0f172a]">
                    <span className="font-mono text-slate-400">{t}.zip</span>
                    {c
                      ? <span className="text-emerald-400 font-mono">
                          {mb(c.tamanhoBytes)} · {new Date(c.geradoEm).toLocaleString('pt-BR')}
                        </span>
                      : <span className="text-slate-600">nenhuma</span>}
                  </div>
                )
              })}
            </div>
          </div>

          {d.historicoEventos?.length > 0 && (
            <div>
              <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">
                Histórico de eventos — registro, não arquivos baixáveis
              </p>
              <div className="max-h-40 overflow-auto space-y-1">
                {d.historicoEventos.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px] p-1.5 rounded bg-[#0f172a] border border-slate-800">
                    <span className="font-mono text-slate-500">
                      {new Date(h.emitidoEm).toLocaleString('pt-BR')} · {h.tipo}
                    </span>
                    <span className={
                      h.status === 'CONFIRMADO' ? 'text-emerald-400'
                      : h.status === 'FALHOU'   ? 'text-red-400'
                      : 'text-yellow-400'
                    }>{h.status} · {mb(h.tamanhoBytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {res && <Console response={res} />}
      {versao > 0 && <p className="text-[10px] text-slate-600 mt-2">Clique de novo após rodar o ciclo para ver mudar.</p>}
    </section>
  )
}

// ── Travas ─────────────────────────────────────────────────────────────────

interface Trava {
  nome:      string
  descricao: string
  esperado:  string
  corpo:     (hwid: string) => Record<string, unknown>
}

const TRAVAS: Trava[] = [
  {
    nome:      'Tamanho acima de 500 MB',
    descricao: 'Pede URL para um arquivo de 900 MB.',
    esperado:  '400 · BACKUP_DADOS_INVALIDOS',
    corpo:     h => ({ hwid: h, tipo: 'banco', tamanhoBytes: 900 * 1024 * 1024 }),
  },
  {
    nome:      'Imagens sem checksum',
    descricao: 'Sem checksum não há como pular upload de imagem que não mudou.',
    esperado:  '400 · BACKUP_CHECKSUM_OBRIGATORIO',
    corpo:     h => ({ hwid: h, tipo: 'imagens', tamanhoBytes: 65536 }),
  },
  {
    nome:      'HWID diferente do token',
    descricao: 'Máquina que não é a da sessão autenticada.',
    esperado:  '403 · BACKUP_HWID_DIVERGENTE',
    corpo:     () => ({ hwid: 'PC-INTRUSO-999', tipo: 'banco', tamanhoBytes: 65536 }),
  },
  {
    nome:      'Arquivo minúsculo',
    descricao: 'Abaixo de 1 KB não é backup de nada.',
    esperado:  '400 · BACKUP_DADOS_INVALIDOS',
    corpo:     h => ({ hwid: h, tipo: 'banco', tamanhoBytes: 10 }),
  },
  {
    nome:      'Queda suspeita de tamanho',
    descricao: 'Só dispara se já existe um backup bem maior. Protege a única cópia boa.',
    esperado:  '409 · BACKUP_TAMANHO_SUSPEITO',
    corpo:     h => ({ hwid: h, tipo: 'banco', tamanhoBytes: 1024 }),
  },
]

function SecaoTravas({ token }: { token: string }) {
  const [rodando, setRodando] = useState<string | null>(null)
  const [saidas,  setSaidas]  = useState<Record<string, { status: number; codigo: string; msg: string }>>({})

  const testar = async (t: Trava) => {
    setRodando(t.nome)
    const r = await api(`${API}/erp/backup/url-upload`, token, {
      method: 'POST',
      body:   JSON.stringify(t.corpo(hwidDoToken(token))),
    })
    const p = r.payload as { codigo?: string; message?: string; acao?: string }
    setSaidas(s => ({
      ...s,
      [t.nome]: {
        status: r.status ?? 0,
        codigo: p?.codigo ?? (r.ok ? `ACEITOU (${p?.acao})` : '—'),
        msg:    p?.message ?? '',
      },
    }))
    setRodando(null)
  }

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-amber-800/50 shadow-xl lg:col-span-2">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-amber-400 uppercase tracking-wider">Travas de Proteção</h2>
        <RotaBadge metodo="POST" rota="/erp/backup/url-upload" />
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Cada botão tenta uma coisa que deve ser <strong>recusada</strong>. Recusa aqui é sucesso —
        é o que impede backup corrompido e fatura inesperada. Nenhum deles sobe arquivo.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {TRAVAS.map(t => {
          const s        = saidas[t.nome]
          const recusou  = s && s.status >= 400
          const aceitou  = s && s.status < 400

          return (
            <div key={t.nome} className={`p-3 rounded border ${
              aceitou ? 'border-red-700/60 bg-red-950/20'
              : recusou ? 'border-emerald-700/50 bg-emerald-950/20'
              : 'border-slate-700/50 bg-[#0f172a]'
            }`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-xs font-bold text-slate-200">{t.nome}</p>
                <button onClick={() => testar(t)} disabled={!token || rodando === t.nome}
                  className="text-[10px] bg-amber-800/60 hover:bg-amber-700 disabled:bg-slate-700 border border-amber-700/50 px-2 py-0.5 rounded shrink-0 transition">
                  {rodando === t.nome ? '...' : 'testar'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mb-1">{t.descricao}</p>
              <p className="text-[10px] font-mono text-slate-600">espera: {t.esperado}</p>

              {s && (
                <p className={`text-[11px] font-mono mt-1.5 ${aceitou ? 'text-red-400' : 'text-emerald-400'}`}>
                  {aceitou ? '✘ PASSOU — trava não funcionou!' : `✔ ${s.status} · ${s.codigo}`}
                  {s.msg && <span className="block opacity-70 mt-0.5">{s.msg}</span>}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Download ───────────────────────────────────────────────────────────────

function SecaoDownload({ token }: { token: string }) {
  const [tipo, setTipo] = useState<'banco' | 'imagens'>('banco')
  const [load, setLoad] = useState(false)
  const [res,  setRes]  = useState<ApiResponse | null>(null)

  const pedir = async () => {
    setLoad(true); setRes(null)
    setRes(await api(`${API}/erp/backup/url-download`, token, {
      method: 'POST',
      body:   JSON.stringify({ hwid: hwidDoToken(token), tipo }),
    }))
    setLoad(false)
  }

  const d = res?.ok ? (res.payload as { url: string; tamanhoBytes: number; geradoEm: string }) : null

  return (
    <section className="bg-[#1e293b] p-5 rounded-xl border border-violet-800/50 shadow-xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-violet-400 uppercase tracking-wider">Restaurar (Download)</h2>
        <RotaBadge metodo="POST" rota="/erp/backup/url-download" />
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Mesmo gate do upload: licença vencida ou em teste não baixa. URL válida por 5 minutos.
      </p>

      <div className="space-y-3">
        <Field label="Tipo">
          <select className={`${ic} focus:border-violet-500`} value={tipo}
            onChange={e => setTipo(e.target.value as 'banco' | 'imagens')}>
            <option value="banco">banco</option>
            <option value="imagens">imagens</option>
          </select>
        </Field>

        <button onClick={pedir} disabled={load || !token}
          className="w-full bg-violet-700 hover:bg-violet-600 disabled:bg-slate-600 text-white font-bold py-2 rounded transition">
          {load ? 'Gerando...' : 'POST /erp/backup/url-download'}
        </button>

        {d && (
          <div className="p-3 rounded border border-violet-700/40 bg-violet-950/20 text-xs space-y-2">
            <p className="text-slate-300">
              {mb(d.tamanhoBytes)} · gerado em {new Date(d.geradoEm).toLocaleString('pt-BR')}
            </p>
            <a href={d.url} target="_blank" rel="noreferrer"
              className="block text-center bg-violet-800/60 hover:bg-violet-700 border border-violet-600/50 py-1.5 rounded font-bold text-violet-200 transition">
              Baixar o arquivo
            </a>
          </div>
        )}

        {res && <Console response={res} />}
      </div>
    </section>
  )
}

// ── Export ─────────────────────────────────────────────────────────────────

export function TemaBackup({ token }: { token: string }) {
  const [versao, setVersao] = useState(0)

  return (
    <div className="space-y-4 lg:col-span-2">
      {!token && (
        <div className="p-4 rounded-xl border border-yellow-700/50 bg-yellow-950/20 text-yellow-400 text-sm font-semibold text-center">
          Faça login no módulo ERP Auth acima para obter o token de licença.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SecaoStatus token={token} versao={versao} />
        <SecaoCiclo  token={token} onFim={() => setVersao(v => v + 1)} />
        <SecaoTravas token={token} />
        <SecaoDownload token={token} />
      </div>
    </div>
  )
}
