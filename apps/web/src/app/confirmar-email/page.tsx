'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Status = 'carregando' | 'sucesso' | 'erro'

export default function ConfirmarEmailPage() {
  const searchParams = useSearchParams()
  const token        = searchParams.get('token')
  const [status, setStatus] = useState<Status>('carregando')

  useEffect(() => {
    if (!token) { setStatus('erro'); return }

    fetch(`${process.env.NEXT_PUBLIC_API_URL}/erp/usuario/confirmar-email?token=${token}`)
      .then(res => res.ok ? setStatus('sucesso') : setStatus('erro'))
      .catch(() => setStatus('erro'))
  }, [token])

  if (status === 'carregando') {
    return (
      <main style={{ fontFamily: 'Arial, sans-serif', textAlign: 'center', paddingTop: '80px' }}>
        <p>Confirmando seu e-mail...</p>
      </main>
    )
  }

  if (status === 'sucesso') {
    return (
      <main style={{ fontFamily: 'Arial, sans-serif', textAlign: 'center', paddingTop: '80px' }}>
        <h2>E-mail confirmado com sucesso!</h2>
        <p>Seu novo e-mail já está ativo. Você pode fechar esta aba.</p>
      </main>
    )
  }

  return (
    <main style={{ fontFamily: 'Arial, sans-serif', textAlign: 'center', paddingTop: '80px' }}>
      <h2>Link inválido ou expirado</h2>
      <p>Solicite uma nova troca de e-mail pelo sistema ERP.</p>
    </main>
  )
}
