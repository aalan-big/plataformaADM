import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

/**
 * Cadastro + checkout numa chamada. Repassa o Origin do navegador para o
 * backend decidir (contra allowlist) para onde o Stripe deve voltar — assim
 * quem comprou em assine. volta para assine., e não para o painel.
 */
export async function POST(request: Request) {
  const body   = await request.json()
  const origin = request.headers.get('origin') ?? new URL(request.url).origin

  const res = await fetch(`${SERVER_URL}/erp/contratar`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body:    JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
