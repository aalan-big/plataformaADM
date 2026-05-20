import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

// Stripe precisa do body exatamente como chegou (bytes originais) para verificar a assinatura
export async function POST(request: Request) {
  try {
    const rawBody = await request.arrayBuffer()
    const sig = request.headers.get('stripe-signature') ?? ''

    const res = await fetch(`${SERVER_URL}/financeiro/webhook/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': sig,
      },
      body: rawBody,
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ erro: 'Backend offline' }, { status: 502 })
  }
}
