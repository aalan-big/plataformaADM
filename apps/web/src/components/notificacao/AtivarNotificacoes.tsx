'use client'

/**
 * Card para ligar as notificações de pagamento neste aparelho.
 *
 * A inscrição é POR DISPOSITIVO, não por conta: quem ativa no iPhone continua
 * sem receber no desktop. Por isso o card mostra o estado deste aparelho, e não
 * uma configuração global — dizer "ativado" enquanto o celular na mão da pessoa
 * não recebe nada seria a pior forma de errar aqui.
 *
 * No iPhone há um degrau extra: notificação web só funciona com o painel
 * instalado na tela inicial. Em aba do Safari a API nem existe — então em vez
 * de oferecer um botão que falha, o card explica o passo que falta.
 */

import { useState, useEffect, useCallback } from 'react'
import { Bell, BellOff, Share, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

/** A chave VAPID vem em base64url e o navegador exige bytes. */
function base64ParaUint8(base64: string) {
  const preenchimento = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalizada   = (base64 + preenchimento).replace(/-/g, '+').replace(/_/g, '/')
  const bruto         = window.atob(normalizada)
  const saida         = new Uint8Array(bruto.length)
  for (let i = 0; i < bruto.length; i++) saida[i] = bruto.charCodeAt(i)
  return saida
}

type Estado = 'carregando' | 'indisponivel' | 'precisa-instalar' | 'desligado' | 'ligado'

export function AtivarNotificacoes() {
  const [estado, setEstado]     = useState<Estado>('carregando')
  const [ocupado, setOcupado]   = useState(false)
  const [aviso, setAviso]       = useState('')
  const [chave, setChave]       = useState('')

  const ehIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

  const verificar = useCallback(async () => {
    // Em standalone o app foi instalado na tela inicial. É o que destrava o
    // push no iOS; no Android e no desktop funciona instalado ou não.
    const instalado = typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
       (window.navigator as { standalone?: boolean }).standalone === true)

    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setEstado(ehIOS && !instalado ? 'precisa-instalar' : 'indisponivel')
      return
    }

    let config: { disponivel: boolean; chavePublica: string } | null = null
    try {
      const res  = await fetch('/api/notificacao/config')
      const json = await res.json()
      config = json.data
    } catch { /* servidor fora — cai no indisponível abaixo */ }

    if (!config?.disponivel || !config.chavePublica) {
      setEstado('indisponivel')
      return
    }
    setChave(config.chavePublica)

    try {
      const registro = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      const atual    = await registro.pushManager.getSubscription()
      setEstado(atual ? 'ligado' : 'desligado')
    } catch {
      setEstado('indisponivel')
    }
  }, [ehIOS])

  useEffect(() => { verificar() }, [verificar])

  async function ligar() {
    setOcupado(true); setAviso('')
    try {
      const permissao = await Notification.requestPermission()
      if (permissao !== 'granted') {
        setAviso('Permissão negada. Libere as notificações do StartBIG nos ajustes do aparelho.')
        return
      }

      const registro = await navigator.serviceWorker.ready
      const inscricao = await registro.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: base64ParaUint8(chave),
      })

      const res = await fetch('/api/notificacao/inscrever', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(inscricao.toJSON()),
      })
      if (!res.ok) throw new Error('O servidor recusou a inscrição.')

      setEstado('ligado')
      setAviso('Pronto. Este aparelho vai avisar a cada pagamento recebido.')
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Não foi possível ativar agora.')
    } finally {
      setOcupado(false)
    }
  }

  async function desligar() {
    setOcupado(true); setAviso('')
    try {
      const registro  = await navigator.serviceWorker.ready
      const inscricao = await registro.pushManager.getSubscription()
      if (inscricao) {
        await fetch('/api/notificacao/desinscrever', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ endpoint: inscricao.endpoint }),
        })
        await inscricao.unsubscribe()
      }
      setEstado('desligado')
      setAviso('Este aparelho não recebe mais avisos.')
    } finally {
      setOcupado(false)
    }
  }

  async function testar() {
    setOcupado(true); setAviso('')
    try {
      const res  = await fetch('/api/notificacao/teste', { method: 'POST' })
      const json = await res.json()
      setAviso(json.msg ?? 'Teste enviado.')
    } finally {
      setOcupado(false)
    }
  }

  if (estado === 'carregando') return null

  const base = 'bg-slate-900 border border-slate-800 rounded-xl p-5'

  if (estado === 'precisa-instalar') {
    return (
      <div className={base}>
        <div className="flex items-start gap-3">
          <Share size={17} className="text-blue-400 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-200">
              Instale o painel para receber avisos de pagamento
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              No iPhone, notificação só funciona com o painel na tela inicial. Toque em{' '}
              <strong className="text-slate-300">Compartilhar</strong> na barra do Safari, escolha{' '}
              <strong className="text-slate-300">Adicionar à Tela de Início</strong> e abra o
              StartBIG por lá. O botão de ativar aparece dentro dele.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (estado === 'indisponivel') {
    return (
      <div className={base}>
        <div className="flex items-start gap-3">
          <AlertCircle size={17} className="text-slate-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-300">Notificações indisponíveis</p>
            <p className="text-xs text-slate-500 mt-1">
              Este navegador não suporta, ou o servidor ainda não tem as chaves de notificação configuradas.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const ligado = estado === 'ligado'

  return (
    <div className={base}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          {ligado
            ? <Bell size={17} className="text-emerald-400 mt-0.5 shrink-0" />
            : <BellOff size={17} className="text-slate-500 mt-0.5 shrink-0" />}
          <div>
            <p className="text-sm font-semibold text-slate-200">
              {ligado ? 'Avisos ligados neste aparelho' : 'Avisos desligados neste aparelho'}
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-md leading-relaxed">
              {ligado
                ? 'Você recebe uma notificação a cada pagamento — PIX, cartão ou confirmação manual. Sem nome de cliente na mensagem.'
                : 'Ative para saber na hora que um cliente pagar, mesmo com o painel fechado.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {ligado && (
            <button onClick={testar} disabled={ocupado}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-40">
              Testar
            </button>
          )}
          <button onClick={ligado ? desligar : ligar} disabled={ocupado}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 flex items-center gap-2 ${
              ligado
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}>
            {ocupado && <Loader2 size={12} className="animate-spin" />}
            {ligado ? 'Desativar' : 'Ativar avisos'}
          </button>
        </div>
      </div>

      {aviso && (
        <p className="text-xs text-slate-400 mt-4 pt-4 border-t border-slate-800 flex items-start gap-2">
          <CheckCircle2 size={13} className="text-emerald-400 mt-0.5 shrink-0" />
          {aviso}
        </p>
      )}
    </div>
  )
}
