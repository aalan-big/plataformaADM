import { NextResponse } from 'next/server'

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001'

export async function POST(request: Request) {
  const rawBody  = await request.arrayBuffer()
  const signature = request.headers.get('stripe-signature') ?? ''

  try {
    const res = await fetch(`${SERVER_URL}/financeiro/webhook/stripe`, {
      method:  'POST',
      headers: {
        'content-type':     'application/json',
        'stripe-signature': signature,
      },
      body: rawBody,
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ erro: 'Falha ao encaminhar webhook' }, { status: 500 })
  }
}
