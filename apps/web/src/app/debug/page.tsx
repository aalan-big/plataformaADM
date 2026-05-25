'use client'

import { useState, useEffect } from 'react'
import { Tema } from './_shared/Tema'
import { TemaLogin } from './_temas/TemaLogin'
import { TemaClientes } from './_temas/TemaClientes'
import { TemaLicencas } from './_temas/TemaLicencas'
import { TemaFinanceiro } from './_temas/TemaFinanceiro'
import { TemaPlano } from './_temas/TemaPlano'

interface UsuarioLogado {
  id:    string
  nome:  string
  email: string
}

// ---------------------------------------------------------------------------
// Status do servidor
// ---------------------------------------------------------------------------
function StatusServidor() {
  const [status, setStatus] = useState<'verificando' | 'online' | 'offline'>('verificando')

  useEffect(() => {
    fetch('/api/ping')
      .then(r => setStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'))
  }, [])

  const cor  = status === 'online' ? 'text-emerald-400' : status === 'offline' ? 'text-red-400' : 'text-slate-500'
  const dot  = status === 'online' ? 'bg-emerald-400' : status === 'offline' ? 'bg-red-500' : 'bg-slate-500'
  const msg  = status === 'online' ? 'Servidor online' : status === 'offline' ? 'Servidor offline' : 'Verificando...'

  return (
    <div className={`flex items-center gap-1.5 text-xs font-semibold ${cor}`}>
      <span className={`w-2 h-2 rounded-full ${dot} ${status === 'online' ? 'animate-pulse' : ''}`} />
      {msg}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Guia rápido de rotas
// ---------------------------------------------------------------------------
const ROTAS = [
  { modulo: 'Auth',      cor: 'text-emerald-400', rotas: ['POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/usuario'] },
  { modulo: 'Clientes',  cor: 'text-rose-400',    rotas: ['GET /api/cliente', 'GET /api/cliente/:id', 'POST /api/cliente/registrar', 'PATCH /api/cliente/:id', 'DELETE /api/cliente/:id'] },
  { modulo: 'Licenças (Admin)',  cor: 'text-indigo-400',  rotas: ['GET /api/licenca/planos', 'GET /api/licenca/cliente/:id', 'POST /api/licenca', 'POST /api/licenca/:id/renovar', 'PATCH /api/licenca/:id/bloquear', 'PATCH /api/licenca/:id/reativar', 'PATCH /api/licenca/:id/resetar-usuarios', 'PATCH /api/licenca/:id/adicionar-extra', 'DELETE /api/licenca/:id'] },
  { modulo: 'Licenças (ERP Público)', cor: 'text-fuchsia-400', rotas: ['POST /api/licenca/auto-cadastro', 'POST /api/licenca/conectar', 'POST /api/licenca/validar', 'POST /api/licenca/heartbeat', 'POST /api/licenca/desconectar'] },
  { modulo: 'Financeiro',cor: 'text-cyan-400',     rotas: ['POST /api/financeiro/confirmar', 'GET /api/financeiro/historico/cliente/:id', 'GET /api/financeiro/historico/licenca/:id', 'GET /api/financeiro/transacoes/cliente/:id', 'GET /api/financeiro/transacoes/licenca/:id', 'GET /api/financeiro/receita', 'POST /api/financeiro/webhook/asaas'] },
  { modulo: 'Planos',    cor: 'text-purple-400',   rotas: ['GET /api/plano', 'POST /api/plano', 'GET /api/plano/:id', 'PUT /api/plano/:id', 'PATCH /api/plano/:id/desativar', 'PATCH /api/plano/:id/reativar'] },
]

function MapaRotas() {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="border border-slate-700/60 rounded-xl overflow-hidden mb-6">
      <button onClick={() => setAberto(!aberto)}
        className="w-full flex items-center justify-between px-5 py-3 bg-slate-800/60 hover:bg-slate-800 transition text-left">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Mapa de Rotas — {ROTAS.reduce((s, r) => s + r.rotas.length, 0)} endpoints</span>
        <span className="text-slate-500 text-sm">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-700/30">
          {ROTAS.map(m => (
            <div key={m.modulo} className="bg-[#0f172a] p-4">
              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${m.cor}`}>{m.modulo}</p>
              <div className="space-y-1.5">
                {m.rotas.map(r => {
                  const [metodo, ...partes] = r.split(' ')
                  const rota = partes.join(' ')
                  const metCor = metodo === 'POST' ? 'text-emerald-400' : metodo === 'GET' ? 'text-sky-400' : metodo === 'DELETE' ? 'text-red-400' : 'text-yellow-400'
                  return (
                    <div key={r} className="flex items-start gap-1.5">
                      <span className={`text-[10px] font-black shrink-0 ${metCor}`}>{metodo}</span>
                      <span className="text-[10px] text-slate-500 font-mono leading-tight">{rota}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bloco de módulo bloqueado
// ---------------------------------------------------------------------------
function Bloqueado({ modulo }: { modulo: string }) {
  return (
    <div className="col-span-2 flex flex-col items-center justify-center py-14 gap-3">
      <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-2xl">🔒</div>
      <p className="text-slate-400 font-semibold text-sm">Faça login para acessar {modulo}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Badge de passo
// ---------------------------------------------------------------------------
function Passo({ n, label, ativo }: { n: number; label: string; ativo: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${ativo ? 'opacity-100' : 'opacity-40'}`}>
      <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-black shrink-0 ${
        ativo ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300' : 'border-slate-600 text-slate-500'
      }`}>{n}</div>
      <span className="text-xs font-semibold text-slate-300">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export default function DebugPage() {
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(null)
  const usuarioId = usuario?.id ?? ''

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 p-6 font-sans max-w-7xl mx-auto">

      {/* Header */}
      <header className="mb-6 pb-5 border-b border-slate-700/80">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-black text-cyan-400 tracking-tight">BigTec API Laboratory</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Ambiente de teste dos módulos — Auth · Clientes · Licenças · Financeiro · Planos
            </p>
          </div>

          <div className="flex flex-col items-end gap-3 shrink-0">
            <StatusServidor />
            {usuario && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-bold text-emerald-400">{usuario.nome}</p>
                  <p className="text-xs text-slate-500 font-mono">{usuario.id.slice(0, 12)}...</p>
                </div>
                <div className="w-9 h-9 rounded-full bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-sm font-bold text-emerald-400">
                  {usuario.nome.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <button onClick={() => setUsuario(null)}
                  className="text-xs text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-2 py-1 rounded transition">
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Fluxo de passos */}
        <div className="flex items-center gap-4 mt-5 pt-4 border-t border-slate-700/40">
          <span className="text-[10px] text-slate-600 uppercase font-bold tracking-wider shrink-0">Fluxo:</span>
          <Passo n={1} label="Login"    ativo={true} />
          <span className="text-slate-700 text-xs">→</span>
          <Passo n={2} label="Clientes" ativo={!!usuario} />
          <span className="text-slate-700 text-xs">→</span>
          <Passo n={3} label="Licenças" ativo={!!usuario} />
          <span className="text-slate-700 text-xs">→</span>
          <Passo n={4} label="Financeiro" ativo={!!usuario} />
          <span className="text-slate-700 text-xs">→</span>
          <Passo n={5} label="Planos" ativo={!!usuario} />
        </div>
      </header>

      {/* Mapa de rotas (colapsável) */}
      <MapaRotas />

      {/* Módulos */}
      <div className="flex flex-col gap-5">

        <Tema titulo="01 — Login & Usuário">
          <TemaLogin onLogin={setUsuario} logado={!!usuario} />
        </Tema>

        <Tema titulo={`02 — Clientes${usuario ? ` · ${usuario.nome}` : ' · faça login primeiro'}`}>
          {usuario
            ? <TemaClientes usuarioId={usuarioId} />
            : <Bloqueado modulo="Clientes" />}
        </Tema>

        <Tema titulo={`03 — Licenças & Dispositivos${usuario ? '' : ' · faça login primeiro'}`}>
          {usuario
            ? <TemaLicencas />
            : <Bloqueado modulo="Licenças" />}
        </Tema>

        <Tema titulo={`04 — Financeiro & Transações${usuario ? '' : ' · faça login primeiro'}`}>
          {usuario
            ? <TemaFinanceiro />
            : <Bloqueado modulo="Financeiro" />}
        </Tema>

        <Tema titulo={`05 — Controle de Planos${usuario ? '' : ' · faça login primeiro'}`}>
          {usuario
            ? <TemaPlano />
            : <Bloqueado modulo="Planos" />}
        </Tema>

      </div>
    </div>
  )
}
