import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

/** Contratação de quem já é cliente. Repassa o Origin pelo mesmo motivo do /contratar. */
export async function POST(request: Request) {
  const body   = await request.json()
  const origin = request.headers.get('origin') ?? new URL(request.url).origin

  const res = await fetch(`${SERVER_URL}/erp/contratar-existente`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body:    JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
