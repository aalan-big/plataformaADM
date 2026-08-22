import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

// Não usa o proxyRequest genérico de propósito: ele monta os headers do zero
// (só Content-Type e o cookie do admin) e descartaria o `asaas-access-token`,
// que é justamente a credencial do webhook. O token chegaria vazio na API e
// toda entrega do Asaas seria recusada — com a causa invisível dos dois lados.
export async function POST(request: Request) {
  try {
    const body  = await request.text()
    const token = request.headers.get('asaas-access-token') ?? ''

    const res = await fetch(`${SERVER_URL}/financeiro/webhook/asaas`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'asaas-access-token': token },
      body,
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ erro: 'Backend offline' }, { status: 502 })
  }
}
