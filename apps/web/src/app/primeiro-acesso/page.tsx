'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Status = 'formulario' | 'enviando' | 'sucesso' | 'erro' | 'token-invalido'

export default function PrimeiroAcessoPage() {
  const searchParams = useSearchParams()
  const token        = searchParams.get('token')
  const [status, setStatus]     = useState<Status>('formulario')
  const [novaSenha, setNovaSenha]         = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [erro, setErro]                   = useState('')

  useEffect(() => {
    if (!token) setStatus('token-invalido')
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro('')

    if (novaSenha.length < 8) {
      setErro('A senha deve ter no mínimo 8 caracteres.')
      return
    }
    if (novaSenha !== confirmarSenha) {
      setErro('As senhas não coincidem.')
      return
    }

    setStatus('enviando')

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/erp/auth/primeiro-acesso`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, novaSenha }),
      })

      if (res.ok) {
        setStatus('sucesso')
      } else {
        const data = await res.json()
        setErro(data.message ?? 'Erro ao criar senha. Tente novamente.')
        setStatus('formulario')
      }
    } catch {
      setErro('Erro de conexão. Verifique sua internet.')
      setStatus('formulario')
    }
  }

  if (status === 'token-invalido') {
    return (
      <main style={styles.container}>
        <h2>Link inválido</h2>
        <p>Este link de primeiro acesso é inválido ou já foi utilizado.</p>
      </main>
    )
  }

  if (status === 'sucesso') {
    return (
      <main style={styles.container}>
        <h2>Senha criada com sucesso!</h2>
        <p>Você já pode fazer login no sistema StartBig com seu e-mail e senha.</p>
      </main>
    )
  }

  return (
    <main style={styles.container}>
      <h2>Crie sua senha de acesso</h2>
      <p style={{ color: '#64748b', marginBottom: 24 }}>
        Defina a senha que você usará para acessar o StartBig.
      </p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>Nova senha</label>
        <input
          type="password"
          value={novaSenha}
          onChange={e => setNovaSenha(e.target.value)}
          placeholder="Mínimo 8 caracteres"
          style={styles.input}
          required
        />

        <label style={styles.label}>Confirmar senha</label>
        <input
          type="password"
          value={confirmarSenha}
          onChange={e => setConfirmarSenha(e.target.value)}
          placeholder="Repita a senha"
          style={styles.input}
          required
        />

        {erro && <p style={{ color: '#ef4444', fontSize: 13 }}>{erro}</p>}

        <button type="submit" disabled={status === 'enviando'} style={styles.button}>
          {status === 'enviando' ? 'Salvando...' : 'Criar senha'}
        </button>
      </form>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily:  'Arial, sans-serif',
    maxWidth:    420,
    margin:      '80px auto',
    padding:     '40px',
    border:      '1px solid #e2e8f0',
    borderRadius: 12,
  },
  form: {
    display:       'flex',
    flexDirection: 'column',
    gap:           12,
  },
  label: {
    fontSize:   13,
    fontWeight: 600,
    color:      '#374151',
  },
  input: {
    padding:      '10px 14px',
    border:       '1px solid #d1d5db',
    borderRadius: 8,
    fontSize:     14,
  },
  button: {
    marginTop:    8,
    padding:      '12px',
    background:   '#3b82f6',
    color:        '#fff',
    border:       'none',
    borderRadius: 8,
    fontSize:     14,
    fontWeight:   600,
    cursor:       'pointer',
  },
}
