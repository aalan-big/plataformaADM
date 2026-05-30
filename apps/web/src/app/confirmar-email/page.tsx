'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Status = 'carregando' | 'sucesso' | 'erro'

function ConfirmarEmailConteudo() {
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
    return <p>Confirmando seu e-mail...</p>
  }

  if (status === 'sucesso') {
    return (
      <>
        <h2>E-mail confirmado com sucesso!</h2>
        <p>Seu novo e-mail já está ativo. Você pode fechar esta aba.</p>
      </>
    )
  }

  return (
    <>
      <h2>Link inválido ou expirado</h2>
      <p>Solicite uma nova troca de e-mail pelo sistema ERP.</p>
    </>
  )
}

export default function ConfirmarEmailPage() {
  return (
    <main style={{ fontFamily: 'Arial, sans-serif', textAlign: 'center', paddingTop: '80px' }}>
      <Suspense fallback={<p>Carregando...</p>}>
        <ConfirmarEmailConteudo />
      </Suspense>
    </main>
  )
}
